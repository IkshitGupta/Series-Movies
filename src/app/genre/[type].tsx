import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { MediaCard } from '@/components/MediaCard';
import { useLibraryStore } from '@/store/useLibraryStore';
import type { MediaItem, TrackedShow, WatchedMovie } from '@/types';

export default function GenreScreen() {
  const router = useRouter();
  const { type, name } = useLocalSearchParams<{ type: string; name: string }>();
  const isMovie = type === 'movie';

  const watchedMovies = useLibraryStore((s) => s.watchedMovies);
  const trackedShows = useLibraryStore((s) => s.trackedShows);

  const items = useMemo<(WatchedMovie | TrackedShow)[]>(() => {
    if (isMovie) {
      return Object.values(watchedMovies)
        .filter((m) => m.genres?.includes(name))
        .sort((a, b) => b.watchedAt - a.watchedAt);
    }
    return Object.values(trackedShows)
      .filter((s) => s.watchedEpisodes.length > 0 && s.genres?.includes(name))
      .sort((a, b) => b.lastUpdated - a.lastUpdated);
  }, [isMovie, name, watchedMovies, trackedShows]);

  const openItem = (item: MediaItem) => {
    if (item.mediaType === 'movie') {
      router.push({ pathname: '/movie/[id]', params: { id: String(item.id) } });
    } else {
      router.push({ pathname: '/show/[id]', params: { id: String(item.id) } });
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: name ?? 'Genre' }} />
      <View className="flex-1 bg-neutral-50 dark:bg-black">
        {items.length === 0 ? (
          <EmptyState
            icon={isMovie ? 'film-outline' : 'tv-outline'}
            title="Nothing here yet"
            message={`No watched ${isMovie ? 'movies' : 'shows'} in ${name}.`}
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => `${item.mediaType}-${item.id}`}
            contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 32 }}
            renderItem={({ item }) => (
              <MediaCard
                item={item}
                onPress={() => openItem(item)}
                subtitle={
                  'watchedEpisodes' in item
                    ? `${Math.min(item.watchedEpisodes.length, item.totalEpisodes || item.watchedEpisodes.length)}/${item.totalEpisodes} episodes watched`
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
