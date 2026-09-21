import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { MediaCard } from '@/components/MediaCard';
import { useLibraryStore } from '@/store/useLibraryStore';
import { MAX_CAST } from '@/lib/normalize';
import type { MediaItem, TrackedShow, WatchedMovie } from '@/types';

export default function PersonScreen() {
  const router = useRouter();
  const { id, name, filter } = useLocalSearchParams<{ id: string; name: string; filter?: string }>();
  const personId = Number(id);

  const watchedMovies = useLibraryStore((s) => s.watchedMovies);
  const trackedShows = useLibraryStore((s) => s.trackedShows);

  const items = useMemo<(WatchedMovie | TrackedShow)[]>(() => {
    const has = (item: { cast?: { id: number }[] }) =>
      item.cast?.slice(0, MAX_CAST).some((c) => c.id === personId) ?? false;
    // Honour the scope the actor was tapped from: the "TV" filter should never
    // list movies (and vice-versa), matching the count shown in the stat.
    const movies = filter === 'tv' ? [] : Object.values(watchedMovies).filter(has);
    const shows =
      filter === 'movie'
        ? []
        : Object.values(trackedShows).filter((s) => s.watchedEpisodes.length > 0 && has(s));
    // Combined list, most recent first (movies by watchedAt, shows by lastUpdated).
    return [...movies, ...shows].sort((a, b) => {
      const at = 'watchedAt' in a ? a.watchedAt : a.lastUpdated;
      const bt = 'watchedAt' in b ? b.watchedAt : b.lastUpdated;
      return bt - at;
    });
  }, [personId, watchedMovies, trackedShows, filter]);

  const openItem = (item: MediaItem) => {
    if (item.mediaType === 'movie') {
      router.push({ pathname: '/movie/[id]', params: { id: String(item.id) } });
    } else {
      router.push({ pathname: '/show/[id]', params: { id: String(item.id) } });
    }
  };

  const scopedTitle = name
    ? filter === 'movie'
      ? `${name} · Movies`
      : filter === 'tv'
        ? `${name} · TV`
        : name
    : 'Cast';

  return (
    <>
      <Stack.Screen options={{ title: scopedTitle }} />
      <View className="flex-1 bg-neutral-50 dark:bg-black">
        {items.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="Nothing here yet"
            message={`No watched ${
              filter === 'movie' ? 'movies' : filter === 'tv' ? 'TV shows' : 'titles'
            } with ${name ?? 'this person'}.`}
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => `${item.mediaType}-${item.id}`}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 32 }}
            renderItem={({ item }) => (
              <MediaCard
                item={item}
                onPress={() => openItem(item)}
                subtitle={
                  'watchedEpisodes' in item
                    ? `${Math.min(item.watchedEpisodes.length, (item.airedEpisodes ?? item.totalEpisodes) || item.watchedEpisodes.length)}/${item.airedEpisodes ?? item.totalEpisodes} episodes watched`
                    : undefined
                }
              />
            )}
          />
        )}
      </View>
    </>
  );
}
