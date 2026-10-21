import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import { useShow } from '@/api/queries';
import { EmptyState } from '@/components/EmptyState';
import { MediaCard } from '@/components/MediaCard';
import { SelectChip } from '@/components/SelectChip';
import { SortBar } from '@/components/SortBar';
import { StatusBadge } from '@/components/StatusBadge';
import { airedEpisodeCount, getUpcoming, localTodayIso, statusEpisodeTotal, upcomingLabel } from '@/lib/airing';
import { findNextEpisode, nextUnwatchedEpisode } from '@/lib/nextEpisode';
import { noteNextAirDate, refreshShowTotals, useShowSchedule } from '@/lib/showRefresh';
import { DEFAULT_SORT, sortLibraryItems, type SortState } from '@/lib/sort';
import { getShowProgress, getShowStatus, useLibraryStore } from '@/store/useLibraryStore';
import { episodeKey, type MediaItem, type ShowStatus, type ShowUserStatus, type TrackedShow } from '@/types';

import { COLORS } from '@/theme/colors';

const STATUS_LABEL: Record<ShowStatus, string> = {
  not_started: 'Not started',
  watching: 'Watching',
  completed: 'Completed',
};

const USER_STATUS_LABEL: Record<ShowUserStatus, string> = {
  stopped: 'Stopped',
  continue_later: 'Continue later',
};

const USER_STATUS_TONE: Record<ShowUserStatus, 'neutral' | 'brand' | 'success' | 'info'> = {
  stopped: 'neutral',
  continue_later: 'info',
};

/** The four TV views: two derived (Watching/Completed) + two manual. */
type TvFilter = 'watching' | 'completed' | 'stopped' | 'continue_later';

const TV_FILTERS: { key: TvFilter; label: string }[] = [
  { key: 'watching', label: 'Watching' },
  { key: 'completed', label: 'Completed' },
  { key: 'continue_later', label: 'Continue later' },
  { key: 'stopped', label: 'Stopped watching' },
];

const TV_EMPTY: Record<TvFilter, { title: string; message: string }> = {
  watching: { title: 'Nothing in progress', message: 'Mark episodes as watched to start a show.' },
  completed: { title: 'No completed shows', message: 'Finish every episode to complete a show.' },
  stopped: {
    title: 'Nothing stopped',
    message: 'Shows you mark “Stopped watching” appear here.',
  },
  continue_later: {
    title: 'Nothing saved for later',
    message: 'Shows you mark “Continue later” appear here.',
  },
};

function showGroup(show: TrackedShow): TvFilter {
  if (show.userStatus === 'stopped') return 'stopped';
  if (show.userStatus === 'continue_later') return 'continue_later';
  return getShowStatus(show) === 'completed' ? 'completed' : 'watching';
}

/** One-tap action to mark a show's next unwatched episode as watched. */
function MarkNextButton({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={8}
      className="flex-row items-center gap-1 rounded-full px-3 py-2 active:opacity-80"
      style={{ backgroundColor: COLORS.brand, opacity: busy ? 0.6 : 1 }}>
      {busy ? (
        <ActivityIndicator size="small" color={COLORS.white} />
      ) : (
        <>
          <Ionicons name="play-forward" size={14} color={COLORS.white} />
          <Text className="text-xs font-semibold text-white">Next</Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * A single Series row. Reads the show's TMDB detail from the shared (cached +
 * persisted) query so it can surface a "new season / new episode coming" badge
 * without extra plumbing; the fetch is deduped with the detail screen.
 */
function SeriesRow({
  item,
  tvFilter,
  busy,
  onOpen,
  onMarkNext,
  hideStatus = false,
}: {
  item: TrackedShow;
  tvFilter: TvFilter;
  busy: boolean;
  onOpen: (item: MediaItem) => void;
  onMarkNext: (show: TrackedShow) => void;
  /** Omit the status pill (e.g. in Completed → Upcoming, where every row is
   * completed) so the air-date badge gets the full width on narrow phones. */
  hideStatus?: boolean;
}) {
  const { data } = useShow(item.id);
  const syncShowMeta = useLibraryStore((s) => s.syncShowMeta);
  // Sync the totals from the fetched detail so the list reflects TMDB without
  // opening each show: aired-based progress (e.g. 20/21, not 20/26), and the
  // status total that moves a finished show back to Watching once its new season
  // premieres. Shows not on screen are kept current by `refreshShowTotals`.
  // Runs on new TMDB data only: a total that sync merged in from another device
  // may be newer than this cached copy, so `refreshShowTotals` settles it from the
  // network instead of the row writing the cache back over it.
  useEffect(() => {
    if (!data) return;
    syncShowMeta(item.id, {
      totalEpisodes: statusEpisodeTotal(data),
      airedEpisodes: airedEpisodeCount(data) ?? undefined,
    });
    noteNextAirDate(item.id, data);
  }, [data, item.id, syncShowMeta]);
  const { watched, total } = getShowProgress(item);
  const status = getShowStatus(item);
  const label = item.userStatus ? USER_STATUS_LABEL[item.userStatus] : STATUS_LABEL[status];
  const tone = item.userStatus
    ? USER_STATUS_TONE[item.userStatus]
    : status === 'completed'
      ? 'success'
      : 'brand';
  const canMarkNext = tvFilter === 'watching' || tvFilter === 'continue_later';
  const upcoming = getUpcoming(data);
  // Surface where to resume: the next unwatched (aired) episode, e.g. "Next: S3·E5"
  // — the episode the Next button plays. Shows the plain count until the show's
  // detail loads (and for completed shows).
  const nextUp =
    status !== 'completed' && data ? nextUnwatchedEpisode(item.watchedEpisodes, data) : undefined;
  const progress = `${watched}${total ? `/${total}` : ''} episodes`;
  let subtitle = `${progress} watched`;
  if (nextUp) {
    subtitle =
      nextUp.kind === 'next'
        ? `Next: S${nextUp.season}·E${nextUp.episode} · ${progress}`
        : `Caught up · ${progress}`;
  }
  // Once every aired episode is watched there's nothing to mark next, so show the
  // status badge instead of a Next button that would otherwise target an unaired
  // episode. A completed show can still sit in "Continue later" (flagged while
  // waiting for an announced season) — nothing to mark next there either.
  const showNext = canMarkNext && status !== 'completed' && nextUp?.kind !== 'caught-up';
  return (
    <MediaCard
      item={item}
      onPress={() => onOpen(item)}
      subtitle={subtitle}
      badge={upcoming ? upcomingLabel(upcoming) : undefined}
      right={
        showNext ? (
          <MarkNextButton busy={busy} onPress={() => onMarkNext(item)} />
        ) : hideStatus ? undefined : (
          <StatusBadge label={label} tone={tone} />
        )
      }
    />
  );
}

export default function SeriesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const trackedShows = useLibraryStore((s) => s.trackedShows);
  const markEpisodesWatched = useLibraryStore((s) => s.markEpisodesWatched);
  const setShowEpisodeRuntime = useLibraryStore((s) => s.setShowEpisodeRuntime);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  // Keep every tracked show's totals current in the background (throttled per
  // show), so new seasons regroup shows even if they're not on screen — on each
  // visit, and when the app returns to the foreground while this tab is open.
  useFocusEffect(
    useCallback(() => {
      void refreshShowTotals(queryClient);
      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'active') void refreshShowTotals(queryClient);
      });
      return () => sub.remove();
    }, [queryClient]),
  );
  // And on every library change (e.g. a sync merged in another device's older
  // totals): only shows whose stored total diverged are re-derived — cheap otherwise.
  useEffect(() => {
    void refreshShowTotals(queryClient);
  }, [trackedShows, queryClient]);

  const shows = useMemo(
    () => sortLibraryItems(Object.values(trackedShows), sort, (s) => s.lastUpdated),
    [trackedShows, sort],
  );

  const [tvFilter, setTvFilter] = useState<TvFilter>('watching');
  const tvGroups = useMemo(() => {
    const groups: Record<TvFilter, TrackedShow[]> = {
      watching: [],
      completed: [],
      stopped: [],
      continue_later: [],
    };
    for (const show of shows) groups[showGroup(show)].push(show);
    return groups;
  }, [shows]);

  // Completed → "Upcoming": finished shows with a confirmed future air date (a new
  // season or episode), soonest first. Dates come from each show's last TMDB check.
  const nextAirDates = useShowSchedule((s) => s.next);
  const checkingSchedule = useShowSchedule((s) => s.checking);
  const [upcomingOnly, setUpcomingOnly] = useState(false);
  const today = localTodayIso();
  const upcomingCompleted = useMemo(
    () =>
      tvGroups.completed
        .filter((s) => (nextAirDates[s.id] ?? '') >= today)
        .sort(
          (a, b) =>
            (nextAirDates[a.id] ?? '').localeCompare(nextAirDates[b.id] ?? '') ||
            a.title.localeCompare(b.title),
        ),
    [tvGroups, nextAirDates, today],
  );
  const showUpcoming = tvFilter === 'completed' && upcomingOnly;
  const listData = showUpcoming ? upcomingCompleted : tvGroups[tvFilter];

  const openItem = (item: MediaItem) => {
    router.push({ pathname: '/show/[id]', params: { id: String(item.id) } });
  };

  const markNext = async (show: TrackedShow) => {
    if (busyId !== null) return;
    setBusyId(show.id);
    try {
      const next = await findNextEpisode(queryClient, show.id, show.watchedEpisodes);
      if (!next) {
        Alert.alert('All caught up', 'You’ve watched every episode that has aired so far.');
        return;
      }
      // Idempotent set-union (not a toggle) so a concurrent sync that already
      // added this episode can't cause the tap to *un*-watch it.
      markEpisodesWatched(show, show.totalEpisodes, [episodeKey(next.season, next.episode)]);
      if (!show.episodeRuntime && next.runtime && next.runtime > 0) {
        setShowEpisodeRuntime(show.id, next.runtime);
      }
      // If the show resumed into the Watching group (e.g. from Continue later),
      // follow it to the Watching view so the user can see where it went.
      const updated = useLibraryStore.getState().trackedShows[show.id];
      if (updated && showGroup(updated) === 'watching' && tvFilter !== 'watching') {
        setTvFilter('watching');
      }
    } catch {
      Alert.alert('Could not mark next episode', 'Please check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          gap: 8,
          paddingVertical: 12,
          alignItems: 'center',
        }}>
        {TV_FILTERS.map((f) => {
          const active = tvFilter === f.key;
          return (
            <SelectChip
              key={f.key}
              label={`${f.label} (${tvGroups[f.key].length})`}
              active={active}
              scrollFix
              onPress={() => setTvFilter(f.key)}
            />
          );
        })}
      </ScrollView>

      <View className="flex-row flex-wrap items-center justify-between gap-2 px-4 pb-2">
        {showUpcoming ? (
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="calendar-outline" size={14} color={COLORS.muted} />
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">
              {checkingSchedule ? 'Soonest first · checking for new dates…' : 'Soonest first'}
            </Text>
          </View>
        ) : (
          <SortBar sort={sort} onChange={setSort} />
        )}
        {tvFilter === 'completed' ? (
          <SelectChip
            label={`Upcoming (${upcomingCompleted.length})`}
            active={upcomingOnly}
            onPress={() => setUpcomingOnly((v) => !v)}
          />
        ) : null}
      </View>

      {listData.length === 0 ? (
        showUpcoming ? (
          <EmptyState
            icon="calendar-outline"
            title={checkingSchedule ? 'Checking for new dates…' : 'Nothing scheduled'}
            message="Completed shows with a confirmed date for a new season or episode appear here."
          />
        ) : (
          <EmptyState
            icon="tv-outline"
            title={TV_EMPTY[tvFilter].title}
            message={TV_EMPTY[tvFilter].message}
          />
        )
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => `tv-${item.id}`}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 8, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <SeriesRow
              item={item}
              tvFilter={tvFilter}
              busy={busyId === item.id}
              onOpen={openItem}
              onMarkNext={markNext}
              hideStatus={showUpcoming}
            />
          )}
        />
      )}
    </View>
  );
}
