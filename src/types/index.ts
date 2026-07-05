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
  totalEpisodes: number;
  lastUpdated: number;
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
}

export interface TmdbSeasonSummary {
  id: number;
  season_number: number;
  name: string;
  episode_count: number;
  poster_path: string | null;
  air_date: string | null;
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
