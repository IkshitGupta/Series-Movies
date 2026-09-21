import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { type ComponentProps, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ProgressBar } from '@/components/ProgressBar';
import { runCastBackfill, useCastBackfillStatus } from '@/lib/castBackfill';
import {
  formatWatchTime,
  getMovieStats,
  getShowStats,
  getTopCast,
  type CastFilter,
  type MediaStats,
  useLibraryStore,
} from '@/store/useLibraryStore';

import { COLORS } from '@/theme/colors';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function GenreBreakdown({
  genres,
  mediaType,
}: {
  genres: MediaStats['genres'];
  mediaType: 'movie' | 'tv';
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const COLLAPSED_COUNT = 6;

  if (genres.length === 0) {
    return (
      <Text className="text-sm text-neutral-400 dark:text-neutral-500">
        No genre data yet — open a title and mark it watched.
      </Text>
    );
  }
  const max = genres[0].count;
  const visible = expanded ? genres : genres.slice(0, COLLAPSED_COUNT);
  const hasMore = genres.length > COLLAPSED_COUNT;
  return (
    <View className="gap-3">
      {visible.map((g) => (
        <Pressable
          key={g.genre}
          onPress={() =>
            router.push({ pathname: '/genre/[type]', params: { type: mediaType, name: g.genre } })
          }
          className="gap-1 active:opacity-60">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1">
              <Text className="text-sm text-neutral-700 dark:text-neutral-200">{g.genre}</Text>
              <Ionicons name="chevron-forward" size={13} color={COLORS.muted} />
            </View>
            <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
              {g.count}
            </Text>
          </View>
          <ProgressBar value={max ? g.count / max : 0} />
        </Pressable>
      ))}
      {hasMore ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          className="flex-row items-center justify-center gap-1 pt-1 active:opacity-60">
          <Text className="text-sm font-semibold text-brand">
            {expanded ? 'Show less' : `Show all ${genres.length}`}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={COLORS.brand}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function StatsSection({
  icon,
  title,
  headline,
  sub,
  stats,
  mediaType,
}: {
  icon: IoniconName;
  title: string;
  headline: string;
  sub: string;
  stats: MediaStats;
  mediaType: 'movie' | 'tv';
}) {
  return (
    <View className="gap-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={18} color={COLORS.brand} />
        <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {title}
        </Text>
      </View>
      <View className="flex-row items-baseline gap-2">
        <Text className="text-4xl font-bold text-neutral-900 dark:text-neutral-50">{headline}</Text>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">{sub}</Text>
      </View>
      <View className="flex-row items-center gap-1.5">
        <Ionicons name="time-outline" size={15} color={COLORS.muted} />
        <Text className="text-sm text-neutral-600 dark:text-neutral-300">
          {formatWatchTime(stats.runtimeMinutes)} of watch time
        </Text>
      </View>
      <View className="h-px bg-neutral-100 dark:bg-neutral-800" />
      <Text className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        By genre
      </Text>
      <GenreBreakdown genres={stats.genres} mediaType={mediaType} />
    </View>
  );
}

const CAST_FILTERS: { key: CastFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'movie', label: 'Movies' },
  { key: 'tv', label: 'TV' },
];

function TopCastSection() {
  const router = useRouter();
  const watchedMovies = useLibraryStore((s) => s.watchedMovies);
  const trackedShows = useLibraryStore((s) => s.trackedShows);
  const [filter, setFilter] = useState<CastFilter>('all');
  const [expanded, setExpanded] = useState(false);
  const backfilling = useCastBackfillStatus((s) => s.running);
  const remaining = useCastBackfillStatus((s) => s.remaining);
  const COLLAPSED_COUNT = 6;

  const cast = useMemo(
    () => getTopCast(watchedMovies, trackedShows, filter),
    [watchedMovies, trackedShows, filter],
  );
  const max = cast[0]?.count ?? 0;
  const visible = expanded ? cast : cast.slice(0, COLLAPSED_COUNT);
  const hasMore = cast.length > COLLAPSED_COUNT;

  return (
    <View className="gap-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <View className="flex-row items-center gap-2">
        <Ionicons name="people-outline" size={18} color={COLORS.brand} />
        <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          Top actors &amp; actresses
        </Text>
      </View>

      <View className="flex-row gap-1 rounded-2xl bg-neutral-200 p-1 dark:bg-neutral-800">
        {CAST_FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => {
                setFilter(f.key);
                setExpanded(false);
              }}
              style={{
                flex: 1,
                alignItems: 'center',
                borderRadius: 12,
                paddingVertical: 8,
                backgroundColor: active ? COLORS.white : 'transparent',
              }}>
              <Text
                style={{ fontSize: 13, fontWeight: '600', color: active ? COLORS.brand : COLORS.mutedDark }}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {cast.length === 0 ? (
        <View className="flex-row items-center gap-2 py-1">
          {backfilling ? <ActivityIndicator size="small" color={COLORS.brand} /> : null}
          <Text className="flex-1 text-sm text-neutral-400 dark:text-neutral-500">
            {backfilling
              ? `Loading actors & actresses… ${remaining} left`
              : 'No cast data yet — open a title and mark it watched to collect it.'}
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {visible.map((c) => (
            <Pressable
              key={c.id}
              onPress={() =>
                router.push({ pathname: '/person/[id]', params: { id: String(c.id), name: c.name } })
              }
              className="gap-1 active:opacity-60">
              <View className="flex-row items-center justify-between">
                <View className="flex-row flex-1 items-center gap-1 pr-2">
                  <Text
                    numberOfLines={1}
                    className="text-sm text-neutral-700 dark:text-neutral-200">
                    {c.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={13} color={COLORS.muted} />
                </View>
                <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
                  {c.count}
                </Text>
              </View>
              <ProgressBar value={max ? c.count / max : 0} />
            </Pressable>
          ))}
          {hasMore ? (
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              accessibilityRole="button"
              className="flex-row items-center justify-center gap-1 pt-1 active:opacity-60">
              <Text className="text-sm font-semibold text-brand">
                {expanded ? 'Show less' : `Show all ${cast.length}`}
              </Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={COLORS.brand} />
            </Pressable>
          ) : null}
          {backfilling ? (
            <View className="flex-row items-center gap-2 pt-1">
              <ActivityIndicator size="small" color={COLORS.muted} />
              <Text className="text-xs text-neutral-400 dark:text-neutral-500">
                Updating… {remaining} left
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

export default function StatsScreen() {
  const watchedMovies = useLibraryStore((s) => s.watchedMovies);
  const trackedShows = useLibraryStore((s) => s.trackedShows);

  const movieStats = useMemo(() => getMovieStats(watchedMovies), [watchedMovies]);
  const showStats = useMemo(() => getShowStats(trackedShows), [trackedShows]);

  // Fill in cast for titles saved before it was tracked, so "Top actors &
  // actresses" covers the whole library. Runs once (guarded); idempotent.
  useEffect(() => {
    void runCastBackfill();
  }, []);

  if (movieStats.total === 0 && showStats.total === 0) {
    return (
      <View className="flex-1 bg-neutral-50 dark:bg-black">
        <EmptyState
          icon="stats-chart"
          title="No stats yet"
          message="Mark movies watched and track TV shows to see your totals and genre breakdown."
        />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-neutral-50 dark:bg-black"
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}>
      <StatsSection
        icon="film-outline"
        title="Movies"
        headline={String(movieStats.total)}
        sub={movieStats.total === 1 ? 'movie watched' : 'movies watched'}
        stats={movieStats}
        mediaType="movie"
      />
      <StatsSection
        icon="tv-outline"
        title="TV Shows"
        headline={String(showStats.total)}
        sub={`show${showStats.total === 1 ? '' : 's'} • ${showStats.episodes ?? 0} episode${
          showStats.episodes === 1 ? '' : 's'
        } watched`}
        stats={showStats}
        mediaType="tv"
      />
      <TopCastSection />
    </ScrollView>
  );
}
