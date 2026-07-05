import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { queryKeys, useSeason, useShow } from '@/api/queries';
import { getSeason } from '@/api/tmdb';
import { EmptyState } from '@/components/EmptyState';
import { EpisodeRow } from '@/components/EpisodeRow';
import { PosterImage } from '@/components/PosterImage';
import { ProgressBar } from '@/components/ProgressBar';
import { WatchlistButton } from '@/components/WatchlistButton';
import { tvToMediaItem } from '@/lib/normalize';
import {
  getShowStatus,
  useLibraryStore,
  useTrackedShow,
} from '@/store/useLibraryStore';
import { episodeKey, type MediaItem, type ShowUserStatus } from '@/types';

const STATUS_OPTS: { key: ShowUserStatus; label: string }[] = [
  { key: 'stopped', label: 'Stopped watching' },
  { key: 'continue_later', label: 'Continue later' },
];

function SeasonEpisodes({
  item,
  totalEpisodes,
  seasonNumber,
  onWatchTillHere,
  busy,
}: {
  item: MediaItem;
  totalEpisodes: number;
  seasonNumber: number;
  onWatchTillHere: (seasonNumber: number, episodeNumber: number) => void;
  busy: string | null;
}) {
  const { data: season, isLoading, isError } = useSeason(item.id, seasonNumber);
  const tracked = useTrackedShow(item.id);
  const toggleEpisode = useLibraryStore((s) => s.toggleEpisode);
  const setSeasonEpisodes = useLibraryStore((s) => s.setSeasonEpisodes);
  const setShowEpisodeRuntime = useLibraryStore((s) => s.setShowEpisodeRuntime);

  const watchedSet = useMemo(
    () => new Set(tracked?.watchedEpisodes ?? []),
    [tracked?.watchedEpisodes],
  );

  // Once the show is tracked, record the average episode runtime (from the
  // actual episodes — TMDB's show-level `episode_run_time` is often empty).
  const trackedId = tracked?.id;
  useEffect(() => {
    if (!season || !trackedId) return;
    const runtimes = season.episodes.map((e) => e.runtime ?? 0).filter((r) => r > 0);
    if (runtimes.length === 0) return;
    const avg = Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length);
    setShowEpisodeRuntime(trackedId, avg);
  }, [season, trackedId, setShowEpisodeRuntime]);

  if (isLoading) {
    return (
      <View className="items-center py-8">
        <ActivityIndicator color="#E50914" />
      </View>
    );
  }

  if (isError || !season) {
    return (
      <Text className="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">
        Couldn’t load episodes for this season.
      </Text>
    );
  }

  const episodes = season.episodes;
  const allWatched =
    episodes.length > 0 &&
    episodes.every((ep) => watchedSet.has(episodeKey(seasonNumber, ep.episode_number)));

  return (
    <View className="px-4">
      <View className="flex-row items-center justify-between py-2">
        <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          Episodes
        </Text>
        <Pressable
          onPress={() =>
            setSeasonEpisodes(
              item,
              totalEpisodes,
              seasonNumber,
              episodes.map((ep) => ep.episode_number),
              !allWatched,
            )
          }
          className="rounded-full bg-neutral-200 px-3 py-1 active:opacity-70 dark:bg-neutral-800">
          <Text className="text-xs font-semibold text-brand">
            {allWatched ? 'Unmark all' : 'Mark all'}
          </Text>
        </Pressable>
      </View>

      <Text className="pb-1 text-xs text-neutral-400 dark:text-neutral-500">
        Tap the ↑ on an episode to mark it and everything earlier as watched.
      </Text>

      {episodes.map((ep) => (
        <EpisodeRow
          key={ep.id}
          episodeNumber={ep.episode_number}
          title={ep.name}
          subtitle={ep.air_date ?? undefined}
          stillPath={ep.still_path}
          watched={watchedSet.has(episodeKey(seasonNumber, ep.episode_number))}
          onToggle={() => toggleEpisode(item, totalEpisodes, seasonNumber, ep.episode_number)}
          onWatchTillHere={() => onWatchTillHere(seasonNumber, ep.episode_number)}
          busy={busy === episodeKey(seasonNumber, ep.episode_number)}
        />
      ))}
    </View>
  );
}

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const showId = Number(id);

  const { data: show, isLoading, isError, error } = useShow(showId);
  const tracked = useTrackedShow(showId);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const markEpisodesWatched = useLibraryStore((s) => s.markEpisodesWatched);
  const setShowStatus = useLibraryStore((s) => s.setShowStatus);
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-50 dark:bg-black">
        <Stack.Screen options={{ title: 'Show' }} />
        <ActivityIndicator color="#E50914" />
      </View>
    );
  }

  if (isError || !show) {
    return (
      <View className="flex-1 bg-neutral-50 dark:bg-black">
        <Stack.Screen options={{ title: 'Show' }} />
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn’t load this show"
          message={error instanceof Error ? error.message : 'Please try again later.'}
        />
      </View>
    );
  }

  const item = tvToMediaItem(show);
  const total = show.number_of_episodes;
  const seasons = show.seasons.filter((s) => s.season_number >= 1 && s.episode_count > 0);
  const activeSeason = selectedSeason ?? seasons[0]?.season_number ?? 1;

  const watchedCount = tracked?.watchedEpisodes.length ?? 0;
  // Clamp for display: imported counts can exceed TMDB's total (split episodes).
  const displayWatched = total > 0 ? Math.min(watchedCount, total) : watchedCount;
  const progress = total > 0 ? displayWatched / total : 0;
  const status = getShowStatus(tracked);
  const userStatus = tracked?.userStatus;
  const effectiveStatusLabel =
    userStatus === 'stopped'
      ? 'Stopped watching'
      : userStatus === 'continue_later'
        ? 'Continue later'
        : status === 'completed'
          ? 'Completed'
          : watchedCount > 0
            ? 'Watching'
            : 'Not started';

  async function fetchEpisodeKeys(
    seasonNumbers: number[],
    limit?: { season: number; episode: number },
  ): Promise<string[]> {
    const seasonsData = await Promise.all(
      seasonNumbers.map((n) =>
        queryClient.fetchQuery({
          queryKey: queryKeys.season(showId, n),
          queryFn: () => getSeason(showId, n),
        }),
      ),
    );
    const keys: string[] = [];
    for (const sd of seasonsData) {
      for (const ep of sd.episodes) {
        if (limit && sd.season_number === limit.season && ep.episode_number > limit.episode) {
          continue;
        }
        keys.push(episodeKey(sd.season_number, ep.episode_number));
      }
    }
    return keys;
  }

  async function markWholeSeries() {
    if (busy) return;
    setBusy('series');
    try {
      const keys = await fetchEpisodeKeys(seasons.map((s) => s.season_number));
      markEpisodesWatched(item, total, keys);
    } finally {
      setBusy(null);
    }
  }

  async function markTillHere(seasonNumber: number, episodeNumber: number) {
    if (busy) return;
    setBusy(episodeKey(seasonNumber, episodeNumber));
    try {
      const seasonNumbers = seasons
        .filter((s) => s.season_number <= seasonNumber)
        .map((s) => s.season_number);
      const keys = await fetchEpisodeKeys(seasonNumbers, {
        season: seasonNumber,
        episode: episodeNumber,
      });
      markEpisodesWatched(item, total, keys);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: show.name }} />
      <ScrollView
        className="flex-1 bg-neutral-50 dark:bg-black"
        contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="flex-row gap-4 p-4">
          <PosterImage path={show.poster_path} size="w342" className="h-48 w-32 rounded-2xl" />
          <View className="flex-1 gap-2">
            <Text className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
              {show.name}
            </Text>
            <Text className="text-sm text-neutral-500 dark:text-neutral-400">
              {[item.year, `${show.number_of_seasons} season${show.number_of_seasons === 1 ? '' : 's'}`]
                .filter(Boolean)
                .join('  •  ')}
            </Text>
            {show.vote_average ? (
              <View className="flex-row items-center gap-1">
                <Ionicons name="star" size={14} color="#f5c518" />
                <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  {show.vote_average.toFixed(1)}
                </Text>
              </View>
            ) : null}
            {show.genres.length > 0 ? (
              <View className="flex-row flex-wrap gap-1">
                {show.genres.map((g) => (
                  <View
                    key={g.id}
                    className="rounded-full bg-neutral-200 px-2 py-0.5 dark:bg-neutral-800">
                    <Text className="text-[11px] text-neutral-600 dark:text-neutral-300">
                      {g.name}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View className="flex-row items-center">
              <WatchlistButton item={item} />
            </View>
          </View>
        </View>

        <View className="gap-2 px-4 pb-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              {effectiveStatusLabel}
            </Text>
            <Text className="text-sm text-neutral-500 dark:text-neutral-400">
              {displayWatched}/{total} episodes
            </Text>
          </View>
          <ProgressBar value={progress} />
          <Pressable
            onPress={markWholeSeries}
            disabled={busy !== null}
            className="mt-1 flex-row items-center justify-center gap-2 rounded-xl bg-neutral-200 py-2 active:opacity-70 dark:bg-neutral-800">
            {busy === 'series' ? (
              <ActivityIndicator size="small" color="#E50914" />
            ) : (
              <Ionicons name="checkmark-done" size={16} color="#E50914" />
            )}
            <Text className="text-sm font-semibold text-brand">
              {status === 'completed' ? 'Whole series watched' : 'Mark whole series watched'}
            </Text>
          </Pressable>
        </View>

        {status !== 'completed' ? (
          <View className="gap-2 px-4 pb-2">
            <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              Status
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {STATUS_OPTS.map((opt) => {
                const active = userStatus === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setShowStatus(item, total, active ? null : opt.key)}
                    className="rounded-full border border-neutral-300 px-3 py-1.5 dark:border-neutral-700"
                    style={active ? { backgroundColor: '#E50914', borderColor: '#E50914' } : undefined}>
                    <Text
                      className="text-xs font-semibold text-neutral-700 dark:text-neutral-200"
                      style={active ? { color: '#ffffff' } : undefined}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {show.overview ? (
          <View className="gap-1 p-4">
            <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
              Overview
            </Text>
            <Text className="text-sm leading-5 text-neutral-600 dark:text-neutral-300">
              {show.overview}
            </Text>
          </View>
        ) : null}

        {seasons.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 8 }}>
            {seasons.map((s) => {
              const active = s.season_number === activeSeason;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setSelectedSeason(s.season_number)}
                  className="rounded-full bg-neutral-200 px-4 py-2 dark:bg-neutral-800"
                  style={active ? { backgroundColor: '#E50914' } : undefined}>
                  <Text
                    className="text-sm font-semibold text-neutral-700 dark:text-neutral-200"
                    style={active ? { color: '#ffffff' } : undefined}>
                    Season {s.season_number}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <SeasonEpisodes
          item={item}
          totalEpisodes={total}
          seasonNumber={activeSeason}
          onWatchTillHere={markTillHere}
          busy={busy}
        />
      </ScrollView>
    </>
  );
}
