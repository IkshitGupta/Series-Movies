import type {
  MediaItem,
  TmdbDiscoverItem,
  TmdbMovieDetails,
  TmdbSearchItem,
  TmdbTvDetails,
} from '@/types';

/** Extract a 4-digit year from a TMDB `YYYY-MM-DD` date string. */
export function yearFromDate(date?: string | null): string | null {
  return date ? date.slice(0, 4) || null : null;
}

/** Normalize a `/search/multi` result, dropping people. */
export function normalizeSearchItem(item: TmdbSearchItem): MediaItem | null {
  if (item.media_type !== 'movie' && item.media_type !== 'tv') return null;
  return {
    id: item.id,
    mediaType: item.media_type,
    title: item.title ?? item.name ?? 'Untitled',
    posterPath: item.poster_path,
    year: yearFromDate(item.release_date ?? item.first_air_date),
  };
}

export function movieToMediaItem(movie: TmdbMovieDetails): MediaItem {
  return {
    id: movie.id,
    mediaType: 'movie',
    title: movie.title,
    posterPath: movie.poster_path,
    year: yearFromDate(movie.release_date),
    genres: movie.genres.map((g) => g.name),
  };
}

export function tvToMediaItem(show: TmdbTvDetails): MediaItem {
  return {
    id: show.id,
    mediaType: 'tv',
    title: show.name,
    posterPath: show.poster_path,
    year: yearFromDate(show.first_air_date),
    genres: show.genres.map((g) => g.name),
  };
}

/** Normalize a `/discover/{movie|tv}` result (which carries no `media_type`). */
export function discoverItemToMediaItem(
  item: TmdbDiscoverItem,
  mediaType: 'movie' | 'tv',
): MediaItem {
  return {
    id: item.id,
    mediaType,
    title: item.title ?? item.name ?? 'Untitled',
    posterPath: item.poster_path,
    year: yearFromDate(item.release_date ?? item.first_air_date),
  };
}
