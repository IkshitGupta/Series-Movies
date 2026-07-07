import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, View } from 'react-native';

import { useDiscoverByKeyword } from '@/api/queries';
import { EmptyState } from '@/components/EmptyState';
import { MediaCard } from '@/components/MediaCard';
import { MediaListSkeleton } from '@/components/Skeleton';
import { WatchlistButton } from '@/components/WatchlistButton';
import type { MediaItem } from '@/types';

export default function KeywordScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const keywordId = Number(id);
  const { data, isLoading, isError } = useDiscoverByKeyword(keywordId);

  const openItem = (item: MediaItem) => {
    if (item.mediaType === 'movie') {
      router.push({ pathname: '/movie/[id]', params: { id: String(item.id) } });
    } else {
      router.push({ pathname: '/show/[id]', params: { id: String(item.id) } });
    }
  };

  const title = name ? `“${name}”` : 'Theme';

  const renderBody = () => {
    if (isLoading) {
      return <MediaListSkeleton />;
    }
    if (isError) {
      return (
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn’t load this theme"
          message="Please try again later."
        />
      );
    }
    if (!data || data.length === 0) {
      return (
        <EmptyState
          icon="sad-outline"
          title="Nothing here"
          message={`No titles tagged ${title}.`}
        />
      );
    }
    return (
      <FlatList
        data={data}
        keyExtractor={(item) => `${item.mediaType}-${item.id}`}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <MediaCard
            item={item}
            onPress={() => openItem(item)}
            right={<WatchlistButton item={item} showCategorizedState />}
          />
        )}
      />
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: name ?? 'Theme' }} />
      <View className="flex-1 bg-neutral-50 dark:bg-black">{renderBody()}</View>
    </>
  );
}
