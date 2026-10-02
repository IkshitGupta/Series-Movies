import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { useKeywordMatch, useSearch, useTrending } from '@/api/queries';
import { hasApiKey } from '@/api/tmdb';
import { unreleasedLabel } from '@/lib/airing';
import { EmptyState } from '@/components/EmptyState';
import { MediaCard } from '@/components/MediaCard';
import { SearchBar } from '@/components/SearchBar';
import { MediaListSkeleton } from '@/components/Skeleton';
import { WatchlistButton } from '@/components/WatchlistButton';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import type { MediaItem } from '@/types';

import { COLORS } from '@/theme/colors';

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query);
  const trimmed = debounced.trim();

  const { data, isLoading, isFetching, isError, error } = useSearch(debounced);
  const trending = useTrending();
  const keywordMatch = useKeywordMatch(debounced);
  const missingKey = !hasApiKey();

  const kw = keywordMatch.data;
  const themeChip =
    kw && trimmed.length >= 3 ? (
      <Pressable
        onPress={() =>
          router.push({ pathname: '/keyword/[id]', params: { id: String(kw.id), name: kw.name } })
        }
        className="mb-2 flex-row items-center gap-2 rounded-xl bg-neutral-100 px-3 py-2.5 active:opacity-80 dark:bg-neutral-900">
        <Ionicons name="sparkles-outline" size={16} color={COLORS.brand} />
        <Text className="flex-1 text-sm text-neutral-700 dark:text-neutral-200">
          Explore the{' '}
          <Text className="font-semibold text-neutral-900 dark:text-neutral-50">“{kw.name}”</Text>{' '}
          theme
        </Text>
        <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
      </Pressable>
    ) : null;

  const openItem = (item: MediaItem) => {
    if (item.mediaType === 'movie') {
      router.push({ pathname: '/movie/[id]', params: { id: String(item.id) } });
    } else {
      router.push({ pathname: '/show/[id]', params: { id: String(item.id) } });
    }
  };

  const renderBody = () => {
    if (missingKey) {
      return (
        <EmptyState
          icon="key-outline"
          title="Add your TMDB API key"
          message="Set EXPO_PUBLIC_TMDB_API_KEY in a .env file to enable search. See the README."
        />
      );
    }
    if (trimmed.length < 2) {
      if (trending.data && trending.data.length > 0) {
        return (
          <FlatList
            data={trending.data}
            keyExtractor={(item) => `${item.mediaType}-${item.id}`}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 32 }}
            ListHeaderComponent={
              <Text className="pb-2 text-base font-semibold text-neutral-900 dark:text-neutral-50">
                Trending this week
              </Text>
            }
            renderItem={({ item }) => (
              <MediaCard
                item={item}
                onPress={() => openItem(item)}
                badge={unreleasedLabel(item.mediaType, item.releaseDate) ?? undefined}
                right={<WatchlistButton item={item} showCategorizedState />}
              />
            )}
          />
        );
      }
      return (
        <EmptyState
          icon="search"
          title="Find something to watch"
          message="Search movies and TV shows to add them to your watchlist or start tracking."
        />
      );
    }
    if (isLoading || (isFetching && !data)) {
      return <MediaListSkeleton />;
    }
    if (isError) {
      return (
        <EmptyState
          icon="alert-circle-outline"
          title="Something went wrong"
          message={error instanceof Error ? error.message : 'Please try again.'}
        />
      );
    }
    if (!data || data.length === 0) {
      return (
        <View className="flex-1 px-4 pt-2">
          {themeChip}
          <EmptyState
            icon="sad-outline"
            title="No results"
            message={`Nothing matches “${trimmed}”.`}
          />
        </View>
      );
    }
    return (
      <FlatList
        data={data}
        keyExtractor={(item) => `${item.mediaType}-${item.id}`}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 32 }}
        ListHeaderComponent={themeChip}
        renderItem={({ item }) => (
          <MediaCard
            item={item}
            onPress={() => openItem(item)}
            badge={unreleasedLabel(item.mediaType, item.releaseDate) ?? undefined}
            right={<WatchlistButton item={item} showCategorizedState />}
          />
        )}
      />
    );
  };

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black">
      <View className="px-4 pt-3">
        <SearchBar value={query} onChangeText={setQuery} />
      </View>
      {renderBody()}
    </View>
  );
}
