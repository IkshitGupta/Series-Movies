import { FlatList, Pressable, Text, View } from 'react-native';

import type { MediaItem } from '@/types';

import { PosterImage } from './PosterImage';

/** Horizontal "More like this" carousel of recommended titles. */
export function RecommendationsRow({
  items,
  onOpen,
}: {
  items: MediaItem[];
  onOpen: (item: MediaItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View className="gap-2 pb-2">
      <Text className="px-4 text-base font-semibold text-neutral-900 dark:text-neutral-50">
        More like this
      </Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => `${item.mediaType}-${item.id}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        renderItem={({ item }) => (
          <Pressable className="w-24 active:opacity-70" onPress={() => onOpen(item)}>
            <PosterImage path={item.posterPath} size="w185" className="h-36 w-24 rounded-xl" />
            <Text
              numberOfLines={2}
              className="pt-1 text-xs font-medium text-neutral-700 dark:text-neutral-200">
              {item.title}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
