import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { MediaCard } from '@/components/MediaCard';
import { StatusBadge } from '@/components/StatusBadge';
import { findNextEpisode } from '@/lib/nextEpisode';
import { getShowProgress, getShowStatus, useLibraryStore } from '@/store/useLibraryStore';
import type { MediaItem, ShowStatus, ShowUserStatus, TrackedShow } from '@/types';

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
      style={{ backgroundColor: '#E50914', opacity: busy ? 0.6 : 1 }}>
      {busy ? (
        <ActivityIndicator size="small" color="#ffffff" />
      ) : (
        <>
          <Ionicons name="play-forward" size={14} color="#ffffff" />
          <Text className="text-xs font-semibold text-white">Next</Text>
        </>
      )}
    </Pressable>
  );
}

export default function SeriesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const trackedShows = useLibraryStore((s) => s.trackedShows);
  const toggleEpisode = useLibraryStore((s) => s.toggleEpisode);
  const setShowEpisodeRuntime = useLibraryStore((s) => s.setShowEpisodeRuntime);
  const [busyId, setBusyId] = useState<number | null>(null);

  const shows = useMemo(
    () => Object.values(trackedShows).sort((a, b) => b.lastUpdated - a.lastUpdated),
    [trackedShows],
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

  const openItem = (item: MediaItem) => {
    router.push({ pathname: '/show/[id]', params: { id: String(item.id) } });
  };

  const markNext = async (show: TrackedShow) => {
    if (busyId !== null) return;
    setBusyId(show.id);
    try {
      const next = await findNextEpisode(queryClient, show.id, show.watchedEpisodes);
      if (!next) return;
      toggleEpisode(show, show.totalEpisodes, next.season, next.episode);
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
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 12 }}>
        {TV_FILTERS.map((f) => {
          const active = tvFilter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setTvFilter(f.key)}
              className="self-start rounded-full border border-neutral-300 px-3 py-1.5 dark:border-neutral-700"
              style={active ? { backgroundColor: '#E50914', borderColor: '#E50914' } : undefined}>
              <Text
                className="text-xs font-semibold text-neutral-700 dark:text-neutral-200"
                style={active ? { color: '#ffffff' } : undefined}>
                {f.label} ({tvGroups[f.key].length})
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {tvGroups[tvFilter].length === 0 ? (
        <EmptyState
          icon="tv-outline"
          title={TV_EMPTY[tvFilter].title}
          message={TV_EMPTY[tvFilter].message}
        />
      ) : (
        <FlatList
          data={tvGroups[tvFilter]}
          keyExtractor={(item) => `tv-${item.id}`}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 8, paddingBottom: 32 }}
          renderItem={({ item }) => {
            const { watched, total } = getShowProgress(item);
            const status = getShowStatus(item);
            const label = item.userStatus
              ? USER_STATUS_LABEL[item.userStatus]
              : STATUS_LABEL[status];
            const tone = item.userStatus
              ? USER_STATUS_TONE[item.userStatus]
              : status === 'completed'
                ? 'success'
                : 'brand';
            const canMarkNext = tvFilter === 'watching' || tvFilter === 'continue_later';
            return (
              <MediaCard
                item={item}
                onPress={() => openItem(item)}
                subtitle={`${watched}${total ? `/${total}` : ''} episodes watched`}
                right={
                  canMarkNext ? (
                    <MarkNextButton busy={busyId === item.id} onPress={() => markNext(item)} />
                  ) : (
                    <StatusBadge label={label} tone={tone} />
                  )
                }
              />
            );
          }}
        />
      )}
    </View>
  );
}
