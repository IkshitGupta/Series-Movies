import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { queryKeys, useSeason, useShow } from '@/api/queries';
import { getSeason } from '@/api/tmdb';
import { Backdrop } from '@/components/Backdrop';
import { EmptyState } from '@/components/EmptyState';
import { EpisodeRow } from '@/components/EpisodeRow';
import { CertBadge } from '@/components/CertBadge';
import { Fact } from '@/components/Fact';
import { PosterImage } from '@/components/PosterImage';
import { ProgressBar } from '@/components/ProgressBar';
import { RecommendationsRow } from '@/components/RecommendationsRow';
import { SelectChip } from '@/components/SelectChip';
import { DetailHeaderSkeleton } from '@/components/Skeleton';
import { Tag } from '@/components/Tag';
import { WatchlistButton } from '@/components/WatchlistButton';
import { getUpcoming, airedEpisodeCount, hasEpisodeAired, upcomingLabel } from '@/lib/airing';
import { tvToMediaItem } from '@/lib/normalize';
import { getTvCertification, normalizeRecommendations } from '@/lib/tmdbExtras';
import {
  formatWatchTime,
  getShowStatus,
  useLibraryStore,
  useTrackedShow,
} from '@/store/useLibraryStore';
import { episodeKey, type MediaItem, type ShowUserStatus } from '@/types';

import { COLORS } from '@/theme/colors';

const STATUS_OPTS: { key: ShowUserStatus; label: string }[] = [
  { key: 'stopped', label: 'Stopped watching' },
  { key: 'continue_later', label: 'Continue later' },
];

function SeasonEpisodes({
  item,
  totalEpisodes,
  seasonNumber,
  onWatchTillHere,
  busy,
}: {
  item: MediaItem;
  totalEpisodes: number;
  seasonNumber: number;
  onWatchTillHere: (seasonNumber: number, episodeNumber: number) => void;
  busy: string | null;
}) {
  const { data: season, isLoading, isError } = useSeason(item.id, seasonNumber);
  const tracked = useTrackedShow(item.id);
  const toggleEpisode = useLibraryStore((s) => s.toggleEpisode);
  const setSeasonEpisodes = useLibraryStore((s) => s.setSeasonEpisodes);
  const setShowEpisodeRuntime = useLibraryStore((s) => s.setShowEpisodeRuntime);

  const watchedSet = useMemo(
    () => new Set(tracked?.watchedEpisodes ?? []),
    [tracked?.watchedEpisodes],
  );

  // Stable per-row handlers so memoized EpisodeRows only re-render when their
  // own `watched`/`busy` changes — toggling one episode no longer re-renders
  // the whole season. EpisodeRow passes back the episode number.
  const handleToggle = useCallback(
    (episode: number) => toggleEpisode(item, totalEpisodes, seasonNumber, episode),
    [toggleEpisode, item, totalEpisodes, seasonNumber],
  );
  const tillRef = useRef(onWatchTillHere);
  useEffect(() => {
    tillRef.current = onWatchTillHere;
  }, [onWatchTillHere]);
  const handleTill = useCallback(
    (episode: number) => tillRef.current(seasonNumber, episode),
    [seasonNumber],
  );

  // Once the show is tracked, record the average episode runtime (from the
  // actual episodes — TMDB's show-level `episode_run_time` is often empty).
  const trackedId = tracked?.id;
  useEffect(() => {
    if (!season || !trackedId) return;
    const runtimes = season.episodes.map((e) => e.runtime ?? 0).filter((r) => r > 0);
    if (runtimes.length === 0) return;
    const avg = Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length);
    setShowEpisodeRuntime(trackedId, avg);
  }, [season, trackedId, setShowEpisodeRuntime]);

  if (isLoading) {
    return (
      <View className="items-center py-8">
        <ActivityIndicator color={COLORS.brand} />
      </View>
    );
  }

  if (isError || !season) {
    return (
      <Text className="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">
        Couldn’t load episodes for this season.
      </Text>
    );
  }

  const episodes = season.episodes;
  // Total runtime of this season's *aired* episodes (matches the per-episode
  // subtitles, which only show a runtime once an episode has aired).
  const seasonRuntime = episodes
    .filter((ep) => hasEpisodeAired(ep.air_date))
    .reduce((sum, ep) => sum + (ep.runtime ?? 0), 0);
  // Only aired episodes can be marked watched; "Mark all" ignores unaired ones so
  // it can't complete a still-airing season. Unmarking clears everything (incl.
  // any stray watched-but-unaired episode from an import).
  const airedEpisodes = episodes.filter((ep) => hasEpisodeAired(ep.air_date));
  // Completion is normally gated on aired episodes only. But if NOTHING in the
  // season has aired yet (e.g. an import marked future episodes watched), fall
  // back to "any episode watched" so those stray marks can still be bulk-cleared
  // instead of leaving the Mark/Unmark button permanently disabled.
  const allWatched =
    airedEpisodes.length > 0
      ? airedEpisodes.every((ep) => watchedSet.has(episodeKey(seasonNumber, ep.episode_number)))
      : episodes.some((ep) => watchedSet.has(episodeKey(seasonNumber, ep.episode_number)));
  const markNumbers = (allWatched ? episodes : airedEpisodes).map((ep) => ep.episode_number);

  return (
    <View className="px-4">
      <View className="flex-row items-center justify-between py-2">
        <View className="flex-row items-baseline gap-2">
          <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
            Episodes
          </Text>
          {seasonRuntime > 0 ? (
            <Text className="text-xs text-neutral-400 dark:text-neutral-500">
              {formatWatchTime(seasonRuntime)}
            </Text>
          ) : null}
        </View>
        <Pressable
          disabled={markNumbers.length === 0}
          onPress={() =>
            setSeasonEpisodes(item, totalEpisodes, seasonNumber, markNumbers, !allWatched)
          }
          className="rounded-full bg-neutral-200 px-3 py-1 active:opacity-70 dark:bg-neutral-800"
          style={{ opacity: markNumbers.length === 0 ? 0.4 : 1 }}>
          <Text className="text-xs font-semibold text-brand">
            {allWatched ? 'Unmark all' : 'Mark all'}
          </Text>
        </Pressable>
      </View>

      <Text className="pb-1 text-xs text-neutral-400 dark:text-neutral-500">
        Tap the ↑ on an episode to mark it and everything earlier as watched.
      </Text>

      {episodes.map((ep) => (
        <EpisodeRow
          key={ep.id}
          episodeNumber={ep.episode_number}
          title={ep.name}
          subtitle={
            hasEpisodeAired(ep.air_date)
              ? ep.runtime
                ? formatWatchTime(ep.runtime)
                : (ep.air_date ?? undefined)
              : (ep.air_date ?? undefined)
          }
          stillPath={ep.still_path}
          watched={watchedSet.has(episodeKey(seasonNumber, ep.episode_number))}
          onToggle={handleToggle}
          onWatchTillHere={handleTill}
          busy={busy === episodeKey(seasonNumber, ep.episode_number)}
          unaired={!hasEpisodeAired(ep.air_date)}
        />
      ))}
    </View>
  );
}

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const showId = Number(id);

  const { data: show, isLoading, isError, error } = useShow(showId);
  const tracked = useTrackedShow(showId);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const markEpisodesWatched = useLibraryStore((s) => s.markEpisodesWatched);
  const setShowStatus = useLibraryStore((s) => s.setShowStatus);
  const syncShowMeta = useLibraryStore((s) => s.syncShowMeta);
  const [busy, setBusy] = useState<string | null>(null);
  // Memoized so the derived MediaItem keeps a stable identity across renders,
  // which keeps SeasonEpisodes' per-row callbacks (and their memoized rows) stable.
  const memoItem = useMemo(() => (show ? tvToMediaItem(show) : null), [show]);

  // Keep episode totals in sync with TMDB: totalEpisodes (incl. announced) so a
  // new season flips a completed show back to watching, and airedEpisodes so
  // progress ignores unaired future episodes.
  useEffect(() => {
    if (!tracked || !show) return;
    syncShowMeta(showId, {
      totalEpisodes: show.number_of_episodes,
      airedEpisodes: airedEpisodeCount(show) ?? undefined,
    });
  }, [tracked, show, showId, syncShowMeta]);

  // Per-episode runtime for the whole-show total estimate. TMDB's show-level
  // `episode_run_time` is frequently empty, so fall back to the average runtime
  // of the currently-shown season's episodes — this makes the total work for a
  // show being *searched/previewed* (not just tracked ones, which stored it). The
  // season is read from the shared query cache (SeasonEpisodes fetches the same
  // key), so this adds no extra request.
  const defaultSeasonNumber = useMemo(
    () => show?.seasons?.find((s) => s.season_number >= 1 && s.episode_count > 0)?.season_number ?? 1,
    [show],
  );
  const runtimeSeason = selectedSeason ?? defaultSeasonNumber;
  const { data: runtimeSeasonData } = useSeason(showId, runtimeSeason, !!show);
  const seasonAvgRuntime = useMemo(() => {
    const runtimes = (runtimeSeasonData?.episodes ?? [])
      .map((e) => e.runtime ?? 0)
      .filter((r) => r > 0);
    if (runtimes.length === 0) return 0;
    return Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length);
  }, [runtimeSeasonData]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Show' }} />
        <DetailHeaderSkeleton />
      </>
    );
  }

  if (isError || !show) {
    return (
      <View className="flex-1 bg-neutral-50 dark:bg-black">
        <Stack.Screen options={{ title: 'Show' }} />
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn’t load this show"
          message={error instanceof Error ? error.message : 'Please try again later.'}
        />
      </View>
    );
  }

  if (!memoItem) return null;
  const item = memoItem;
  const total = show.number_of_episodes;
  // Best-effort whole-show runtime: per-episode runtime (from the show, or the
  // avg we stored when a season was viewed) × episode count. Shown as an estimate.
  const perEpisodeRuntime =
    show.episode_run_time?.[0] || tracked?.episodeRuntime || seasonAvgRuntime || 0;
  const showRuntimeTotal = perEpisodeRuntime > 0 ? perEpisodeRuntime * total : 0;
  // Episodes released so far — the denominator for progress (excludes unaired).
  const airedTotal = airedEpisodeCount(show) ?? total;
  const seasons = show.seasons.filter((s) => s.season_number >= 1 && s.episode_count > 0);
  const activeSeason = selectedSeason ?? seasons[0]?.season_number ?? 1;

  const watchedCount = tracked?.watchedEpisodes.length ?? 0;
  // Clamp for display against episodes released so far (excludes unaired future).
  const displayWatched = airedTotal > 0 ? Math.min(watchedCount, airedTotal) : watchedCount;
  const progress = airedTotal > 0 ? displayWatched / airedTotal : 0;
  const status = getShowStatus(tracked);
  const userStatus = tracked?.userStatus;
  const upcoming = getUpcoming(show);
  const effectiveStatusLabel =
    userStatus === 'stopped'
      ? 'Stopped watching'
      : userStatus === 'continue_later'
        ? 'Continue later'
        : status === 'completed'
          ? 'Completed'
          : watchedCount > 0
            ? 'Watching'
            : 'Not started';

  const cert = getTvCertification(show);
  const network = (show.networks ?? [])[0]?.name ?? null;
  const recs = normalizeRecommendations(show.recommendations?.results, 'tv').slice(0, 12);
  const showType = show.type && show.type !== 'Scripted' ? show.type : null;
  const hasFacts = Boolean(showType);
  const openRec = (rec: MediaItem) => {
    if (rec.mediaType === 'movie') {
      router.push({ pathname: '/movie/[id]', params: { id: String(rec.id) } });
    } else {
      router.push({ pathname: '/show/[id]', params: { id: String(rec.id) } });
    }
  };

  async function fetchEpisodeKeys(
    seasonNumbers: number[],
    limit?: { season: number; episode: number },
  ): Promise<string[]> {
    const seasonsData = await Promise.all(
      seasonNumbers.map((n) =>
        queryClient.fetchQuery({
          queryKey: queryKeys.season(showId, n),
          queryFn: () => getSeason(showId, n),
        }),
      ),
    );
    const keys: string[] = [];
    for (const sd of seasonsData) {
      for (const ep of sd.episodes) {
        if (limit && sd.season_number === limit.season && ep.episode_number > limit.episode) {
          continue;
        }
        // Skip unaired episodes so "mark whole series"/"watched up to here" can't
        // mark episodes that haven't been released yet.
        if (!hasEpisodeAired(ep.air_date)) continue;
        keys.push(episodeKey(sd.season_number, ep.episode_number));
      }
    }
    return keys;
  }

  async function markWholeSeries() {
    if (busy) return;
    setBusy('series');
    try {
      const keys = await fetchEpisodeKeys(seasons.map((s) => s.season_number));
      markEpisodesWatched(item, total, keys);
    } finally {
      setBusy(null);
    }
  }

  async function markTillHere(seasonNumber: number, episodeNumber: number) {
    if (busy) return;
    setBusy(episodeKey(seasonNumber, episodeNumber));
    try {
      const seasonNumbers = seasons
        .filter((s) => s.season_number <= seasonNumber)
        .map((s) => s.season_number);
      const keys = await fetchEpisodeKeys(seasonNumbers, {
        season: seasonNumber,
        episode: episodeNumber,
      });
      markEpisodesWatched(item, total, keys);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: show.name }} />
      <ScrollView
        className="flex-1 bg-neutral-50 dark:bg-black"
        contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="relative overflow-hidden">
          <Backdrop path={show.backdrop_path} />
          <View className="flex-row gap-4 p-4">
            <PosterImage path={show.poster_path} size="w342" className="h-48 w-32 rounded-2xl" />
            <View className="flex-1 gap-2">
              <Text className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
                {show.name}
              </Text>
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-sm text-neutral-500 dark:text-neutral-400">
                  {[
                    item.year,
                    `${show.number_of_seasons} season${show.number_of_seasons === 1 ? '' : 's'}`,
                    showRuntimeTotal > 0 ? `~${formatWatchTime(showRuntimeTotal)}` : null,
                  ]
                    .filter(Boolean)
                    .join('  •  ')}
                </Text>
                {cert ? <CertBadge value={cert} /> : null}
                {network ? <Tag label={network} icon="tv-outline" /> : null}
              </View>
              {show.tagline ? (
                <Text className="text-sm italic text-neutral-500 dark:text-neutral-400">
                  {show.tagline}
                </Text>
              ) : null}
              {show.vote_average ? (
                <View className="flex-row items-center gap-1">
                  <Ionicons name="star" size={14} color={COLORS.gold} />
                  <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    {show.vote_average.toFixed(1)}
                  </Text>
                </View>
              ) : null}
              {show.genres.length > 0 ? (
                <View className="flex-row flex-wrap gap-1">
                  {show.genres.map((g) => (
                    <Tag key={g.id} label={g.name} />
                  ))}
                </View>
              ) : null}
              <View className="flex-row items-center">
                <WatchlistButton item={item} />
              </View>
            </View>
          </View>
        </View>

        {upcoming ? (
          <View className="mx-4 mb-1 flex-row items-center gap-2 rounded-xl bg-neutral-100 px-3 py-2 dark:bg-neutral-900">
            <Ionicons name="calendar-outline" size={16} color={COLORS.brand} />
            <Text className="text-sm font-semibold text-brand">{upcomingLabel(upcoming)}</Text>
          </View>
        ) : null}

        <View className="gap-2 px-4 pb-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              {effectiveStatusLabel}
            </Text>
            <Text className="text-sm text-neutral-500 dark:text-neutral-400">
              {displayWatched}/{airedTotal} episodes
            </Text>
          </View>
          <ProgressBar value={progress} />
          <Pressable
            onPress={markWholeSeries}
            disabled={busy !== null}
            className="mt-1 flex-row items-center justify-center gap-2 rounded-xl bg-neutral-200 py-2 active:opacity-70 dark:bg-neutral-800">
            {busy === 'series' ? (
              <ActivityIndicator size="small" color={COLORS.brand} />
            ) : (
              <Ionicons name="checkmark-done" size={16} color={COLORS.brand} />
            )}
            <Text className="text-sm font-semibold text-brand">
              {status === 'completed' ? 'Whole series watched' : 'Mark whole series watched'}
            </Text>
          </Pressable>
        </View>

        {status !== 'completed' ? (
          <View className="gap-2 px-4 pb-2">
            <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              Status
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {STATUS_OPTS.map((opt) => {
                const active = userStatus === opt.key;
                return (
                  <SelectChip
                    key={opt.key}
                    label={opt.label}
                    active={active}
                    onPress={() => setShowStatus(item, total, active ? null : opt.key)}
                  />
                );
              })}
            </View>
          </View>
        ) : null}

        {show.overview ? (
          <View className="gap-1 p-4">
            <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
              Overview
            </Text>
            <Text className="text-sm leading-5 text-neutral-600 dark:text-neutral-300">
              {show.overview}
            </Text>
          </View>
        ) : null}

        {hasFacts ? (
          <View className="gap-1 px-4 pb-2">
            {showType ? <Fact label="Type" value={showType} /> : null}
          </View>
        ) : null}

        {seasons.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 8 }}>
            {seasons.map((s) => {
              const active = s.season_number === activeSeason;
              return (
                <SelectChip
                  key={s.id}
                  label={`Season ${s.season_number}`}
                  active={active}
                  variant="filled"
                  size="md"
                  onPress={() => setSelectedSeason(s.season_number)}
                />
              );
            })}
          </ScrollView>
        ) : null}

        <SeasonEpisodes
          item={item}
          totalEpisodes={total}
          seasonNumber={activeSeason}
          onWatchTillHere={markTillHere}
          busy={busy}
        />

        <RecommendationsRow items={recs} onOpen={openRec} />
      </ScrollView>
    </>
  );
}
