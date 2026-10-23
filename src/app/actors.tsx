import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { CastFilterTabs } from '@/components/CastFilterTabs';
import { EmptyState } from '@/components/EmptyState';
import { ProgressBar } from '@/components/ProgressBar';
import { SearchBar } from '@/components/SearchBar';
import { runCastBackfill, useCastBackfillStatus } from '@/lib/castBackfill';
import { foldForSearch, matchesAllWords, queryWords } from '@/lib/searchText';
import {
  getTopCast,
  rankCast,
  TOP_CAST_LIMIT,
  type CastFilter,
  type RankedCast,
  useLibraryStore,
} from '@/store/useLibraryStore';
import { COLORS } from '@/theme/colors';

const SCOPE_SUFFIX: Record<CastFilter, string> = { all: '', movie: ' in Movies', tv: ' in TV' };

/** Rank column width at the default text size. It grows with the user's font
 * size so the names stay aligned and "#150" never wraps. */
const RANK_WIDTH = 44;

function toFilter(value: string | undefined): CastFilter {
  return value === 'movie' || value === 'tv' ? value : 'all';
}

const ActorRow = memo(function ActorRow({
  actor,
  max,
  rankWidth,
  onPress,
}: {
  actor: RankedCast;
  max: number;
  rankWidth: number;
  onPress: (actor: RankedCast) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(actor)}
      role="button"
      aria-label={`Rank ${actor.rank}, ${actor.name}, ${actor.count} ${actor.count === 1 ? 'title' : 'titles'}`}
      className="flex-row items-center active:opacity-60">
      <Text
        numberOfLines={1}
        style={{ minWidth: rankWidth }}
        className="pr-2 text-sm font-semibold text-neutral-400 dark:text-neutral-500">
        #{actor.rank}
      </Text>
      <View className="flex-1 gap-1">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 flex-row items-center gap-1 pr-2">
            <Text
              numberOfLines={1}
              className="flex-shrink text-sm text-neutral-700 dark:text-neutral-200">
              {actor.name}
            </Text>
            <Ionicons name="chevron-forward" size={13} color={COLORS.muted} />
          </View>
          <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
            {actor.count}
          </Text>
        </View>
        <ProgressBar value={max ? actor.count / max : 0} />
      </View>
    </Pressable>
  );
});

export default function ActorsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string; focus?: string }>();
  // The scope lives in the route params, so a reload (or a restored web page)
  // reopens the same list.
  const filter = toFilter(params.filter);
  const [autoFocus] = useState(() => params.focus === '1');
  const [query, setQuery] = useState('');
  const { fontScale } = useWindowDimensions();
  const listRef = useRef<FlatList<RankedCast>>(null);
  const watchedMovies = useLibraryStore((s) => s.watchedMovies);
  const trackedShows = useLibraryStore((s) => s.trackedShows);
  const backfilling = useCastBackfillStatus((s) => s.running);
  const remaining = useCastBackfillStatus((s) => s.remaining);

  // Opened directly (e.g. a web link), the Stats tab may not have started it.
  useEffect(() => {
    void runCastBackfill();
  }, []);

  // Focusing the search is a one-time request; drop it so a reload doesn't repeat it.
  useEffect(() => {
    if (params.focus !== undefined) router.setParams({ focus: undefined });
  }, [params.focus, router]);

  const setFilter = useCallback((next: CastFilter) => router.setParams({ filter: next }), [router]);

  const { ranked, folded } = useMemo(() => {
    const list = rankCast(getTopCast(watchedMovies, trackedShows, filter));
    return { ranked: list, folded: list.map((c) => foldForSearch(c.name)) };
  }, [watchedMovies, trackedShows, filter]);

  const words = useMemo(() => queryWords(query), [query]);
  const queryKey = words.join(' ');
  const matches = useMemo(
    () =>
      words.length === 0 ? ranked : ranked.filter((_, i) => matchesAllWords(folded[i], words)),
    [ranked, folded, words],
  );
  // Bars stay scaled to the scope's #1 so they don't jump while filtering.
  const max = ranked[0]?.count ?? 0;
  const rankWidth = RANK_WIDTH * Math.max(1, fontScale);

  // A new search or scope starts from the top; cast updates and coming back
  // from an actor keep the current position.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [filter, queryKey]);

  const openActor = useCallback(
    (actor: RankedCast) =>
      router.push({
        pathname: '/person/[id]',
        params: { id: String(actor.id), name: actor.name, filter },
      }),
    [router, filter],
  );
  const renderItem = useCallback(
    ({ item }: { item: RankedCast }) => (
      <ActorRow actor={item} max={max} rankWidth={rankWidth} onPress={openActor} />
    ),
    [max, rankWidth, openActor],
  );

  const total = ranked.length;
  const caption =
    words.length > 0
      ? `${matches.length} of ${total} ${matches.length === 1 ? 'matches' : 'match'}`
      : `${total >= TOP_CAST_LIMIT ? `Top ${TOP_CAST_LIMIT}` : `All ${total}`} · ranked by titles watched · ties share a rank`;

  const renderBody = () => {
    if (total === 0) {
      return backfilling ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <ActivityIndicator color={COLORS.brand} />
          <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">
            Loading actors &amp; actresses… {remaining} left
          </Text>
        </View>
      ) : (
        <EmptyState
          icon="people-outline"
          title="No cast data yet"
          message="Open a title and mark it watched to collect it."
        />
      );
    }
    return (
      <FlatList
        ref={listRef}
        data={matches}
        keyExtractor={(c) => String(c.id)}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        // react-native-web blurs the focused input on every scroll event, not just
        // drags (e.g. the one a shrinking list fires while typing), so web keeps
        // the keyboard and leaves dismissing it to the user.
        keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 32,
          gap: 14,
        }}
        ListHeaderComponent={
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-xs text-neutral-500 dark:text-neutral-400">{caption}</Text>
            {backfilling ? (
              <View className="flex-row items-center gap-1.5">
                <ActivityIndicator size="small" color={COLORS.muted} />
                <Text className="text-xs text-neutral-400 dark:text-neutral-500">
                  Updating… {remaining} left
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="search"
            title={`No actors match “${query.trim()}”`}
            message={`Search looks through your top ${total}${SCOPE_SUFFIX[filter]}.`}
          />
        }
      />
    );
  };

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black">
      <View className="gap-3 px-4 pt-3">
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={
            total >= TOP_CAST_LIMIT ? `Search your top ${TOP_CAST_LIMIT}` : 'Search by name'
          }
          autoFocus={autoFocus}
        />
        <CastFilterTabs value={filter} onChange={setFilter} />
      </View>
      {renderBody()}
    </View>
  );
}
