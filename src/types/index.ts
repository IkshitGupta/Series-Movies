/**
 * Shared domain + TMDB API types for MoviesSeriesHub.
 */

export type MediaType = 'movie' | 'tv';

/** A normalized movie/show reference used across the app and local storage. */
export interface MediaItem {
  id: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  year: string | null;
  /** Genre names. Populated from detail responses; absent for search results. */
  genres?: string[];
}

/** An item on the single "To Watch" list. */
export interface WatchlistItem extends MediaItem {
  addedAt: number;
}

/** A movie the user has marked watched. */
export interface WatchedMovie extends MediaItem {
  watchedAt: number;
  /** Runtime in minutes (from TMDB), used for total watch-time stats. */
  runtime?: number;
}

/**
 * A TV show the user is tracking. Progress is stored as a set of episode keys
 * (see {@link episodeKey}). `totalEpisodes` (from TMDB) lets us compute status.
 */
export interface TrackedShow extends MediaItem {
  watchedEpisodes: string[];
  /** When each episode was marked watched (epoch ms), keyed by {@link episodeKey}.
   * Recorded on interactive marking (and restored from imports that carry dates);
   * may be absent for episodes marked before this was tracked. Internal data for
   * future history/recap features — not surfaced in the UI yet. */
  episodeWatchedAt?: Record<string, number>;
  totalEpisodes: number;
  lastUpdated: number;
  /** Episodes released so far (from TMDB), used for progress so unaired future
   * episodes aren't counted as "remaining". Falls back to totalEpisodes. */
  airedEpisodes?: number;
  /** Manual watch state chosen by the user; does not affect stats. */
  userStatus?: ShowUserStatus;
  /** Typical episode runtime in minutes (from TMDB), for total watch-time stats. */
  episodeRuntime?: number;
}

export type ShowStatus = 'not_started' | 'watching' | 'completed';

/**
 * Manual watch state a user can set for a TV show. "Watching" and "Completed"
 * are derived from episode progress instead (see {@link getShowStatus}).
 */
export type ShowUserStatus = 'stopped' | 'continue_later';

/** App appearance preference. `system` follows the device setting. */
export type ThemePref = 'system' | 'light' | 'dark';

/** Stable key for a single episode, e.g. `S1E4`. */
export function episodeKey(seasonNumber: number, episodeNumber: number): string {
  return `S${seasonNumber}E${episodeNumber}`;
}

/** Composite key so a movie and a show can share a numeric TMDB id. */
export function mediaKey(mediaType: MediaType, id: number): string {
  return `${mediaType}-${id}`;
}

// ---------------------------------------------------------------------------
// TMDB API response shapes (only the fields we consume).
// ---------------------------------------------------------------------------

export interface TmdbSearchItem {
  id: number;
  media_type: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  vote_average?: number;
}

export interface TmdbSearchResponse {
  page: number;
  results: TmdbSearchItem[];
  total_pages: number;
  total_results: number;
}

export interface TmdbKeyword {
  id: number;
  name: string;
}

export interface TmdbKeywordSearchResponse {
  results: TmdbKeyword[];
}

/** A `/discover/movie` or `/discover/tv` result (no `media_type`; set by caller). */
export interface TmdbDiscoverItem {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
}

export interface TmdbDiscoverResponse {
  results: TmdbDiscoverItem[];
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

export interface TmdbCompany {
  id: number;
  name: string;
  logo_path?: string | null;
}

/** Recommended/similar titles (from `recommendations`). */
export interface TmdbRecommendationItem {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  media_type?: 'movie' | 'tv';
}

export interface TmdbRecommendations {
  results: TmdbRecommendationItem[];
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  runtime: number | null;
  vote_average: number;
  genres: TmdbGenre[];
  credits?: { cast: TmdbCastMember[] };
  tagline?: string;
  original_language?: string;
  production_companies?: TmdbCompany[];
  recommendations?: TmdbRecommendations;
  release_dates?: {
    results: {
      iso_3166_1: string;
      release_dates: { certification: string; type: number }[];
    }[];
  };
}

export interface TmdbSeasonSummary {
  id: number;
  season_number: number;
  name: string;
  episode_count: number;
  poster_path: string | null;
  air_date: string | null;
}

/** The next unaired episode TMDB knows about (from `/tv/{id}.next_episode_to_air`). */
export interface TmdbNextEpisode {
  air_date: string | null;
  episode_number: number;
  season_number: number;
  /** e.g. "premiere" | "standard" | "mid_season" | "finale". */
  episode_type?: string;
  name: string;
}

export interface TmdbTvDetails {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  number_of_episodes: number;
  number_of_seasons: number;
  vote_average: number;
  episode_run_time: number[];
  genres: TmdbGenre[];
  seasons: TmdbSeasonSummary[];
  credits?: { cast: TmdbCastMember[] };
  /** Lifecycle, e.g. "Returning Series" | "Ended" | "Canceled" | "In Production". */
  status: string;
  in_production: boolean;
  next_episode_to_air: TmdbNextEpisode | null;
  /** The most recent episode that has already aired (null if none yet). */
  last_episode_to_air: TmdbNextEpisode | null;
  tagline?: string;
  /** e.g. "Scripted" | "Miniseries" | "Documentary". */
  type?: string;
  original_language?: string;
  networks?: TmdbCompany[];
  recommendations?: TmdbRecommendations;
  content_ratings?: { results: { iso_3166_1: string; rating: string }[] };
}

export interface TmdbEpisode {
  id: number;
  episode_number: number;
  season_number: number;
  name: string;
  overview: string;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
}

export interface TmdbSeasonDetails {
  id: number;
  season_number: number;
  name: string;
  episodes: TmdbEpisode[];
}
