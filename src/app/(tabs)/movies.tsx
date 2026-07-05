import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { MediaCard } from '@/components/MediaCard';
import { useLibraryStore } from '@/store/useLibraryStore';
import type { MediaItem } from '@/types';

function UnwatchButton({ id }: { id: number }) {
  const unmark = useLibraryStore((s) => s.unmarkMovieWatched);
  return (
    <Pressable
      hitSlop={8}
      accessibilityLabel="Mark as not watched"
      onPress={() => unmark(id)}
      className="h-10 w-10 items-center justify-center active:opacity-60">
      <Ionicons name="checkmark-circle" size={26} color="#16a34a" />
    </Pressable>
  );
}

export default function MoviesScreen() {
  const router = useRouter();
  const watchedMovies = useLibraryStore((s) => s.watchedMovies);

  const movies = useMemo(
    () => Object.values(watchedMovies).sort((a, b) => b.watchedAt - a.watchedAt),
    [watchedMovies],
  );

  const openItem = (item: MediaItem) => {
    router.push({ pathname: '/movie/[id]', params: { id: String(item.id) } });
  };

  if (movies.length === 0) {
    return (
      <View className="flex-1 bg-neutral-50 dark:bg-black">
        <EmptyState
          icon="film-outline"
          title="No watched movies yet"
          message="Open a movie and tap “Mark watched” to build your history."
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black">
      <FlatList
        data={movies}
        keyExtractor={(item) => `movie-${item.id}`}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <MediaCard item={item} onPress={() => openItem(item)} right={<UnwatchButton id={item.id} />} />
        )}
      />
    </View>
  );
}
