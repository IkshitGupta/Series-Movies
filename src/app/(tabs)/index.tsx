import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { useSearch } from '@/api/queries';
import { hasApiKey } from '@/api/tmdb';
import { EmptyState } from '@/components/EmptyState';
import { MediaCard } from '@/components/MediaCard';
import { SearchBar } from '@/components/SearchBar';
import { WatchlistButton } from '@/components/WatchlistButton';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import type { MediaItem } from '@/types';

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query);
  const trimmed = debounced.trim();

  const { data, isLoading, isFetching, isError, error } = useSearch(debounced);
  const missingKey = !hasApiKey();

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
      return (
        <EmptyState
          icon="search"
          title="Find something to watch"
          message="Search movies and TV shows to add them to your watchlist or start tracking."
        />
      );
    }
    if (isLoading || (isFetching && !data)) {
      return (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#E50914" />
        </View>
      );
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
        <EmptyState
          icon="sad-outline"
          title="No results"
          message={`Nothing matches “${trimmed}”.`}
        />
      );
    }
    return (
      <FlatList
        data={data}
        keyExtractor={(item) => `${item.mediaType}-${item.id}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <MediaCard
            item={item}
            onPress={() => openItem(item)}
            right={<WatchlistButton item={item} />}
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
