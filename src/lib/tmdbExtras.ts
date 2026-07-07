import type {
  MediaItem,
  TmdbMovieDetails,
  TmdbRecommendationItem,
  TmdbTvDetails,
} from '@/types';

import { yearFromDate } from './normalize';

/** Region used for content ratings. */
export const REGION = 'US';

/** Age certification for a movie (from `release_dates`), e.g. "PG-13". */
export function getMovieCertification(movie?: TmdbMovieDetails): string | null {
  const region = movie?.release_dates?.results?.find((r) => r.iso_3166_1 === REGION);
  const cert = region?.release_dates?.find((d) => d.certification)?.certification;
  return cert || null;
}

/** Content rating for a show (from `content_ratings`), e.g. "TV-MA". */
export function getTvCertification(show?: TmdbTvDetails): string | null {
  const rating = show?.content_ratings?.results?.find((r) => r.iso_3166_1 === REGION)?.rating;
  return rating || null;
}

/**
 * Normalize recommendation results into MediaItems. `fallbackType` is used when
 * a result has no `media_type` (movie recs return movies, tv recs return shows).
 */
export function normalizeRecommendations(
  items: TmdbRecommendationItem[] | undefined,
  fallbackType: 'movie' | 'tv',
): MediaItem[] {
  return (items ?? [])
    .map((item): MediaItem | null => {
      const mediaType = item.media_type ?? fallbackType;
      if (mediaType !== 'movie' && mediaType !== 'tv') return null;
      const title = item.title ?? item.name;
      if (!title) return null;
      return {
        id: item.id,
        mediaType,
        title,
        posterPath: item.poster_path,
        year: yearFromDate(item.release_date ?? item.first_air_date),
      };
    })
    .filter((m): m is MediaItem => m !== null);
}
