import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useMovie } from '@/api/queries';
import { Backdrop } from '@/components/Backdrop';
import { EmptyState } from '@/components/EmptyState';
import { CertBadge } from '@/components/CertBadge';
import { Fact } from '@/components/Fact';
import { PosterImage } from '@/components/PosterImage';
import { RecommendationsRow } from '@/components/RecommendationsRow';
import { DetailHeaderSkeleton } from '@/components/Skeleton';
import { Tag } from '@/components/Tag';
import { WatchlistButton } from '@/components/WatchlistButton';
import { movieToMediaItem } from '@/lib/normalize';
import { getMovieCertification, normalizeRecommendations } from '@/lib/tmdbExtras';
import { profileUrl } from '@/lib/tmdbImage';
import { useIsMovieWatched, useLibraryStore } from '@/store/useLibraryStore';
import type { MediaItem } from '@/types';

import { COLORS } from '@/theme/colors';

function formatRuntime(min: number | null): string | null {
  if (!min) return null;
  const hours = Math.floor(min / 60);
  const mins = min % 60;
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
}

export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const movieId = Number(id);
  const router = useRouter();

  const { data: movie, isLoading, isError, error } = useMovie(movieId);
  const watched = useIsMovieWatched(movieId);
  const markWatched = useLibraryStore((s) => s.markMovieWatched);
  const unmark = useLibraryStore((s) => s.unmarkMovieWatched);
  const setMovieRuntime = useLibraryStore((s) => s.setMovieRuntime);

  // Record the runtime once the movie is watched (used for total-time stats).
  useEffect(() => {
    if (watched && movie?.runtime) setMovieRuntime(movieId, movie.runtime);
  }, [watched, movie?.runtime, movieId, setMovieRuntime]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Movie' }} />
        <DetailHeaderSkeleton />
      </>
    );
  }

  if (isError || !movie) {
    return (
      <View className="flex-1 bg-neutral-50 dark:bg-black">
        <Stack.Screen options={{ title: 'Movie' }} />
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn’t load this movie"
          message={error instanceof Error ? error.message : 'Please try again later.'}
        />
      </View>
    );
  }

  const item = movieToMediaItem(movie);
  const runtime = formatRuntime(movie.runtime);
  const cast = movie.credits?.cast?.slice(0, 12) ?? [];
  const cert = getMovieCertification(movie);
  const recs = normalizeRecommendations(movie.recommendations?.results, 'movie').slice(0, 12);
  const studios = (movie.production_companies ?? []).slice(0, 3).map((c) => c.name);
  const hasFacts = studios.length > 0;

  const openRec = (rec: MediaItem) => {
    if (rec.mediaType === 'movie') {
      router.push({ pathname: '/movie/[id]', params: { id: String(rec.id) } });
    } else {
      router.push({ pathname: '/show/[id]', params: { id: String(rec.id) } });
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: movie.title }} />
      <ScrollView
        className="flex-1 bg-neutral-50 dark:bg-black"
        contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="relative overflow-hidden">
          <Backdrop path={movie.backdrop_path} />
          <View className="flex-row gap-4 p-4">
            <PosterImage path={movie.poster_path} size="w342" className="h-48 w-32 rounded-2xl" />
            <View className="flex-1 gap-2">
              <Text className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
                {movie.title}
              </Text>
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-sm text-neutral-500 dark:text-neutral-400">
                  {[item.year, runtime].filter(Boolean).join('  •  ')}
                </Text>
                {cert ? <CertBadge value={cert} /> : null}
              </View>
              {movie.tagline ? (
                <Text className="text-sm italic text-neutral-500 dark:text-neutral-400">
                  {movie.tagline}
                </Text>
              ) : null}
              {movie.vote_average ? (
                <View className="flex-row items-center gap-1">
                  <Ionicons name="star" size={14} color={COLORS.gold} />
                  <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    {movie.vote_average.toFixed(1)}
                  </Text>
                </View>
              ) : null}
              <View className="flex-row flex-wrap gap-1">
                {movie.genres.map((g) => (
                  <Tag key={g.id} label={g.name} />
                ))}
              </View>
            </View>
          </View>
        </View>

        <View className="flex-row items-center gap-3 px-4">
          <Pressable
            onPress={() => (watched ? unmark(movieId) : markWatched(item))}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-3 active:opacity-80"
            style={{ backgroundColor: watched ? COLORS.success : COLORS.brand }}>
            <Ionicons
              name={watched ? 'checkmark-circle' : 'add-circle-outline'}
              size={20}
              color="white"
            />
            <Text className="text-base font-semibold text-white">
              {watched ? 'Watched' : 'Mark watched'}
            </Text>
          </Pressable>
          {!watched ? (
            <View className="rounded-2xl bg-neutral-200 dark:bg-neutral-800">
              <WatchlistButton item={item} />
            </View>
          ) : null}
        </View>

        {movie.overview ? (
          <View className="gap-1 p-4">
            <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
              Overview
            </Text>
            <Text className="text-sm leading-5 text-neutral-600 dark:text-neutral-300">
              {movie.overview}
            </Text>
          </View>
        ) : null}

        {hasFacts ? (
          <View className="gap-1 px-4 pb-2">
            {studios.length > 0 ? <Fact label="Studio" value={studios.join(', ')} /> : null}
          </View>
        ) : null}

        {cast.length > 0 ? (
          <View className="gap-2 pb-2">
            <Text className="px-4 text-base font-semibold text-neutral-900 dark:text-neutral-50">
              Top cast
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
              {cast.map((person) => {
                const url = profileUrl(person.profile_path);
                return (
                  <View key={person.id} className="w-20 items-center gap-1">
                    <View className="h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                      {url ? (
                        <Image
                          source={{ uri: url }}
                          contentFit="cover"
                          style={{ width: '100%', height: '100%' }}
                        />
                      ) : (
                        <Ionicons name="person" size={24} color={COLORS.muted} />
                      )}
                    </View>
                    <Text
                      numberOfLines={1}
                      className="text-center text-[11px] font-medium text-neutral-700 dark:text-neutral-200">
                      {person.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      className="text-center text-[10px] text-neutral-500 dark:text-neutral-400">
                      {person.character}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <RecommendationsRow items={recs} onOpen={openRec} />
      </ScrollView>
    </>
  );
}
