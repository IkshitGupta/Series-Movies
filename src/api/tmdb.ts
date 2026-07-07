import type {
  TmdbDiscoverResponse,
  TmdbKeywordSearchResponse,
  TmdbMovieDetails,
  TmdbSearchResponse,
  TmdbSeasonDetails,
  TmdbTvDetails,
} from '@/types';

const BASE_URL = 'https://api.themoviedb.org/3';

/** Error thrown for any non-2xx TMDB response or missing configuration. */
export class TmdbError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TmdbError';
    this.status = status;
  }
}

/** Whether a TMDB API key has been configured via `.env`. */
export function hasApiKey(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_TMDB_API_KEY);
}

function getApiKey(): string {
  const key = process.env.EXPO_PUBLIC_TMDB_API_KEY;
  if (!key) {
    throw new TmdbError(
      'Missing TMDB API key. Copy .env.example to .env and set EXPO_PUBLIC_TMDB_API_KEY.',
    );
  }
  return key;
}

type QueryParams = Record<string, string | number | boolean>;

// Build the query string manually to avoid relying on URL/URLSearchParams,
// whose support varies across React Native runtimes.
function buildQuery(params: QueryParams): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

async function tmdbFetch<T>(path: string, params: QueryParams = {}): Promise<T> {
  const query = buildQuery({ api_key: getApiKey(), ...params });
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}?${query}`);
  } catch {
    throw new TmdbError('Network error contacting TMDB. Check your connection.');
  }

  if (!res.ok) {
    let message = `TMDB request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { status_message?: string };
      if (body?.status_message) message = body.status_message;
    } catch {
      // response body was not JSON; keep the generic message
    }
    throw new TmdbError(message, res.status);
  }

  return (await res.json()) as T;
}

/** Search movies + TV shows (people are filtered out during normalization). */
export function searchMulti(query: string): Promise<TmdbSearchResponse> {
  return tmdbFetch<TmdbSearchResponse>('/search/multi', {
    query,
    include_adult: false,
    page: 1,
  });
}

export function getMovie(id: number): Promise<TmdbMovieDetails> {
  return tmdbFetch<TmdbMovieDetails>(`/movie/${id}`, {
    append_to_response: 'credits,recommendations,release_dates',
  });
}

export function getTv(id: number): Promise<TmdbTvDetails> {
  return tmdbFetch<TmdbTvDetails>(`/tv/${id}`, {
    append_to_response: 'credits,recommendations,content_ratings',
  });
}

/** Trending movies + TV this week (mixed), for the Search screen's discovery view. */
export function getTrending(): Promise<TmdbSearchResponse> {
  return tmdbFetch<TmdbSearchResponse>('/trending/all/week', {});
}

/** Look up TMDB keywords matching a free-text query (e.g. "heist" → {id, name}). */
export function searchKeyword(query: string): Promise<TmdbKeywordSearchResponse> {
  return tmdbFetch<TmdbKeywordSearchResponse>('/search/keyword', { query, page: 1 });
}

/** Discover movies or shows tagged with a keyword id, most popular first. */
export function discoverByKeyword(
  keywordId: number,
  mediaType: 'movie' | 'tv',
): Promise<TmdbDiscoverResponse> {
  return tmdbFetch<TmdbDiscoverResponse>(`/discover/${mediaType}`, {
    with_keywords: keywordId,
    sort_by: 'popularity.desc',
    include_adult: false,
    page: 1,
  });
}

export function getSeason(tvId: number, seasonNumber: number): Promise<TmdbSeasonDetails> {
  return tmdbFetch<TmdbSeasonDetails>(`/tv/${tvId}/season/${seasonNumber}`);
}

interface TmdbFindResponse {
  tv_results: { id: number; name: string }[];
  movie_results: { id: number; title: string }[];
}

/** Map an external TheTVDB series id to a TMDB show id (or null if unmatched). */
export async function findTmdbIdByTvdbId(tvdbId: string | number): Promise<number | null> {
  const res = await tmdbFetch<TmdbFindResponse>(`/find/${tvdbId}`, {
    external_source: 'tvdb_id',
  });
  return res.tv_results?.[0]?.id ?? null;
}

/** Map an external IMDb id (e.g. `tt1790864`) to a TMDB movie id (or null). */
export async function findMovieIdByImdbId(imdbId: string): Promise<number | null> {
  const res = await tmdbFetch<TmdbFindResponse>(`/find/${imdbId}`, {
    external_source: 'imdb_id',
  });
  return res.movie_results?.[0]?.id ?? null;
}

/** Map an external TheTVDB movie id to a TMDB movie id (or null). */
export async function findMovieIdByTvdbId(tvdbId: string | number): Promise<number | null> {
  const res = await tmdbFetch<TmdbFindResponse>(`/find/${tvdbId}`, {
    external_source: 'tvdb_id',
  });
  return res.movie_results?.[0]?.id ?? null;
}

/**
 * Last-resort movie lookup by title (optionally disambiguated by release year),
 * used when a title has no resolvable external id. Returns null if nothing matches.
 */
export async function searchMovieByTitle(
  title: string,
  year?: number | null,
): Promise<number | null> {
  const params: QueryParams = { query: title, include_adult: false, page: 1 };
  if (year) params.year = year;
  const res = await tmdbFetch<TmdbSearchResponse>('/search/movie', params);
  return res.results?.[0]?.id ?? null;
}
