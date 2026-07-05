import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { MediaCard } from '@/components/MediaCard';
import { WatchlistButton } from '@/components/WatchlistButton';
import { useLibraryStore } from '@/store/useLibraryStore';
import type { MediaItem } from '@/types';

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: 'center',
        borderRadius: 12,
        paddingVertical: 8,
        backgroundColor: active ? '#ffffff' : 'transparent',
      }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: active ? '#E50914' : '#6b7280' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function WatchlistScreen() {
  const router = useRouter();
  const watchlist = useLibraryStore((s) => s.watchlist);
  const [tab, setTab] = useState<'movies' | 'tv'>('movies');

  const movies = useMemo(() => watchlist.filter((w) => w.mediaType === 'movie'), [watchlist]);
  const shows = useMemo(() => watchlist.filter((w) => w.mediaType === 'tv'), [watchlist]);
  const data = tab === 'movies' ? movies : shows;

  const openItem = (item: MediaItem) => {
    if (item.mediaType === 'movie') {
      router.push({ pathname: '/movie/[id]', params: { id: String(item.id) } });
    } else {
      router.push({ pathname: '/show/[id]', params: { id: String(item.id) } });
    }
  };

  if (watchlist.length === 0) {
    return (
      <View className="flex-1 bg-neutral-50 dark:bg-black">
        <EmptyState
          icon="bookmark-outline"
          title="Your watchlist is empty"
          message="Find movies and shows in Search and tap the bookmark to save them here."
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black">
      <View className="mx-4 mt-3 flex-row gap-1 rounded-2xl bg-neutral-200 p-1 dark:bg-neutral-800">
        <SegmentButton
          label={`Movies (${movies.length})`}
          active={tab === 'movies'}
          onPress={() => setTab('movies')}
        />
        <SegmentButton
          label={`TV Series (${shows.length})`}
          active={tab === 'tv'}
          onPress={() => setTab('tv')}
        />
      </View>

      {data.length === 0 ? (
        <EmptyState
          icon={tab === 'movies' ? 'film-outline' : 'tv-outline'}
          title={tab === 'movies' ? 'No movies to watch' : 'No series to watch'}
          message="Find titles in Search and tap the bookmark to save them here."
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => `${item.mediaType}-${item.id}`}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <MediaCard
              item={item}
              onPress={() => openItem(item)}
              right={<WatchlistButton item={item} />}
            />
          )}
        />
      )}
    </View>
  );
}
