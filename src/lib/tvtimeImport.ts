/**
 * TV Time export importer (JSON format).
 *
 * The export is a ZIP containing `tvtime-movies-*.json` and `tvtime-series-*.json`
 * (plus an HTML summary we ignore). We unzip in pure JS via fflate, parse both
 * files, resolve every item to TMDB (movies by IMDb id, shows by TheTVDB id), and
 * build library-ready records: watched movies, tracked shows (with per-episode
 * progress + manual status), and watchlist entries. Anything we can't confidently
 * match is collected for a downloadable report.
 *
 * Note: the JSON export contains NO runtime data (unlike the older CSV), so all
 * runtimes are sourced from TMDB detail responses.
 */
import { unzipSync, strFromU8 } from 'fflate';

import {
  findMovieIdByImdbId,
  findMovieIdByTvdbId,
  findTmdbIdByTvdbId,
  getMovie,
  getSeason,
  getTv,
  searchMovieByTitle,
  TmdbError,
} from '@/api/tmdb';
import {
  episodeKey,
  type MediaItem,
  type ShowUserStatus,
  type TmdbTvDetails,
  type TrackedShow,
  type WatchedMovie,
  type WatchlistItem,
} from '@/types';

// ---------------------------------------------------------------------------
// Raw JSON shapes (only the fields we read).
// ---------------------------------------------------------------------------

interface TvTimeId {
  tvdb: number | null;
  imdb: string | null;
  /** TMDB id — present in our own exports so import can skip the /find lookup. */
  tmdb?: number | null;
}

interface TvTimeMovieRaw {
  id: TvTimeId;
  title: string;
  year: number | null;
  watched_at: string | null;
  is_watched: boolean;
}

interface TvTimeEpisodeRaw {
  number: number;
  special: boolean;
  is_watched: boolean;
}

interface TvTimeSeasonRaw {
  number: number;
  is_specials: boolean;
  episodes: TvTimeEpisodeRaw[];
}

interface TvTimeSeriesRaw {
  id: TvTimeId;
  title: string;
  status: string;
  seasons: TvTimeSeasonRaw[];
}

// ---------------------------------------------------------------------------
// Parsed (pre-resolution) shapes.
// ---------------------------------------------------------------------------

interface ParsedMovie {
  imdbId: string | null;
  tvdbId: number | null;
  tmdbId: number | null;
  title: string;
  year: number | null;
  watchedAt: number | null;
  isWatched: boolean;
}

interface ParsedShow {
  tvdbId: number | null;
  tmdbId: number | null;
  title: string;
  episodeKeys: Set<string>;
  firstWatchedSeason: number | null;
  userStatus?: ShowUserStatus;
  hasWatched: boolean;
}

export interface ParsedExport {
  movies: ParsedMovie[];
  shows: ParsedShow[];
}

/** An export item that couldn't be confidently mapped to TMDB. */
export interface UnmatchedItem {
  type: 'show' | 'movie';
  title: string;
  /** IMDb id (movies) or TheTVDB id (shows). */
  identifier: string;
  /** Watched episodes lost (shows); 0 for movies. */
  episodesWatched: number;
  reason: string;
}

export interface ImportCounts {
  movies: number;
  shows: number;
  episodes: number;
  watchlist: number;
}

export interface ImportResult {
  shows: Record<number, TrackedShow>;
  movies: Record<number, WatchedMovie>;
  watchlist: WatchlistItem[];
  unmatched: UnmatchedItem[];
  counts: ImportCounts;
}

export interface ImportProgress {
  processed: number;
  total: number;
  currentTitle: string;
}

// ---------------------------------------------------------------------------
// Parsing.
// ---------------------------------------------------------------------------

/** Map TV Time's per-show status onto the app's manual watch state. */
function mapUserStatus(status: string): ShowUserStatus | undefined {
  if (status === 'stopped') return 'stopped';
  if (status === 'watch_later') return 'continue_later';
  return undefined;
}

function toEpochMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function findEntry(files: Record<string, Uint8Array>, keyword: string): Uint8Array | undefined {
  const name = Object.keys(files).find(
    (n) => n.toLowerCase().includes(keyword) && n.toLowerCase().endsWith('.json'),
  );
  return name ? files[name] : undefined;
}

/**
 * Unzip a TV Time JSON export and normalize it into parsed movies + shows.
 * @throws if neither the movies nor series JSON file can be found.
 */
export function parseTvTimeZip(bytes: Uint8Array): ParsedExport {
  const files = unzipSync(bytes, {
    filter: (f) => f.name.toLowerCase().endsWith('.json'),
  });

  const moviesRaw = findEntry(files, 'movies');
  const seriesRaw = findEntry(files, 'series');
  if (!moviesRaw && !seriesRaw) {
    throw new Error(
      "Couldn't find the movies/series JSON in the ZIP. Make sure you selected a valid data export (.zip).",
    );
  }

  const movies: ParsedMovie[] = [];
  if (moviesRaw) {
    const raw = JSON.parse(strFromU8(moviesRaw)) as TvTimeMovieRaw[];
    for (const m of raw) {
      movies.push({
        imdbId: m.id?.imdb ?? null,
        tvdbId: m.id?.tvdb ?? null,
        tmdbId: m.id?.tmdb ?? null,
        title: m.title,
        year: m.year ?? null,
        watchedAt: toEpochMs(m.watched_at),
        isWatched: Boolean(m.is_watched),
      });
    }
  }

  const shows: ParsedShow[] = [];
  if (seriesRaw) {
    const raw = JSON.parse(strFromU8(seriesRaw)) as TvTimeSeriesRaw[];
    for (const s of raw) {
      const episodeKeys = new Set<string>();
      let firstWatchedSeason: number | null = null;
      for (const season of s.seasons ?? []) {
        // Skip specials (season 0); the app tracks numbered episodes only.
        if (season.number < 1 || season.is_specials) continue;
        for (const ep of season.episodes ?? []) {
          if (!ep.is_watched || ep.special) continue;
          episodeKeys.add(episodeKey(season.number, ep.number));
          if (firstWatchedSeason == null || season.number < firstWatchedSeason) {
            firstWatchedSeason = season.number;
          }
        }
      }
      shows.push({
        tvdbId: s.id?.tvdb ?? null,
        tmdbId: s.id?.tmdb ?? null,
        title: s.title,
        episodeKeys,
        firstWatchedSeason,
        userStatus: mapUserStatus(s.status),
        hasWatched: episodeKeys.size > 0,
      });
    }
  }

  return { movies, shows };
}

// ---------------------------------------------------------------------------
// TMDB resolution.
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry transient failures (rate limit / network) but surface real HTTP errors. */
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err instanceof TmdbError ? err.status : undefined;
      const transient = status === 429 || status === undefined || (status >= 500 && status < 600);
      if (transient && attempt < retries) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Typical episode runtime (minutes) for a show. TMDB's `episode_run_time` is often
 * empty, so fall back to averaging the first watched season's episode runtimes —
 * the same source the live app uses.
 */
async function resolveEpisodeRuntime(
  tvId: number,
  details: TmdbTvDetails,
  firstWatchedSeason: number | null,
): Promise<number | undefined> {
  const declared = details.episode_run_time?.find((r) => r > 0);
  if (declared) return declared;
  if (firstWatchedSeason == null) return undefined;
  try {
    const season = await withRetry(() => getSeason(tvId, firstWatchedSeason));
    const runtimes = season.episodes
      .map((e) => e.runtime)
      .filter((r): r is number => typeof r === 'number' && r > 0);
    if (runtimes.length > 0) {
      return Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length);
    }
  } catch {
    // fall through — leave runtime unknown
  }
  return undefined;
}

/** Run async tasks with a bounded concurrency pool (order-independent). */
async function runPool(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const idx = next++;
      await tasks[idx]();
    }
  });
  await Promise.all(workers);
}

/**
 * Resolve a parsed export against TMDB, producing library-ready records for
 * watched movies, tracked shows, and watchlist items, plus unmatched entries.
 */
export async function resolveLibrary(
  parsed: ParsedExport,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const shows: Record<number, TrackedShow> = {};
  const movies: Record<number, WatchedMovie> = {};
  const watchlist: WatchlistItem[] = [];
  const unmatched: UnmatchedItem[] = [];
  let episodes = 0;

  const total = parsed.movies.length + parsed.shows.length;
  let processed = 0;
  const bump = (currentTitle: string) => {
    processed++;
    onProgress?.({ processed, total, currentTitle });
  };

  onProgress?.({ processed: 0, total, currentTitle: '' });

  const movieTasks = parsed.movies.map((m) => async () => {
    try {
      // Prefer a direct TMDB id (present in our own exports); otherwise resolve
      // via external ids / title search (real TV Time exports).
      let movieId: number | null = m.tmdbId ?? null;
      if (movieId == null && m.imdbId) movieId = await withRetry(() => findMovieIdByImdbId(m.imdbId!));
      if (movieId == null && m.tvdbId != null) {
        movieId = await withRetry(() => findMovieIdByTvdbId(m.tvdbId!));
      }
      if (movieId == null) movieId = await withRetry(() => searchMovieByTitle(m.title, m.year));
      if (movieId == null) {
        unmatched.push({
          type: 'movie',
          title: m.title,
          identifier: m.imdbId ?? (m.tvdbId != null ? String(m.tvdbId) : ''),
          episodesWatched: 0,
          reason: 'No TMDB match',
        });
        return;
      }

      const d = await withRetry(() => getMovie(movieId!));
      const base: MediaItem = {
        id: movieId,
        mediaType: 'movie',
        title: d.title,
        posterPath: d.poster_path,
        year: d.release_date ? d.release_date.slice(0, 4) : m.year != null ? String(m.year) : null,
        genres: d.genres?.map((g) => g.name) ?? [],
      };
      if (m.isWatched) {
        movies[movieId] = {
          ...base,
          watchedAt: m.watchedAt ?? Date.now(),
          runtime: d.runtime ?? undefined,
        };
      } else {
        watchlist.push({ ...base, addedAt: Date.now() });
      }
    } catch (err) {
      unmatched.push({
        type: 'movie',
        title: m.title,
        identifier: m.imdbId ?? '',
        episodesWatched: 0,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      bump(m.title);
    }
  });

  const showTasks = parsed.shows.map((s) => async () => {
    try {
      // Prefer a direct TMDB id (our own exports); otherwise resolve via TheTVDB.
      let tmdbId: number | null = s.tmdbId ?? null;
      if (tmdbId == null) {
        if (s.tvdbId == null) {
          unmatched.push({
            type: 'show',
            title: s.title,
            identifier: '',
            episodesWatched: s.episodeKeys.size,
            reason: 'No TheTVDB id in export',
          });
          return;
        }
        tmdbId = await withRetry(() => findTmdbIdByTvdbId(s.tvdbId!));
      }
      if (tmdbId == null) {
        unmatched.push({
          type: 'show',
          title: s.title,
          identifier: s.tvdbId != null ? String(s.tvdbId) : '',
          episodesWatched: s.episodeKeys.size,
          reason: 'No TMDB match',
        });
        return;
      }

      const d = await withRetry(() => getTv(tmdbId));
      const base: MediaItem = {
        id: tmdbId,
        mediaType: 'tv',
        title: d.name,
        posterPath: d.poster_path,
        year: d.first_air_date ? d.first_air_date.slice(0, 4) : null,
        genres: d.genres?.map((g) => g.name) ?? [],
      };
      if (s.hasWatched) {
        const episodeRuntime = await resolveEpisodeRuntime(tmdbId, d, s.firstWatchedSeason);
        shows[tmdbId] = {
          ...base,
          watchedEpisodes: [...s.episodeKeys],
          totalEpisodes: d.number_of_episodes,
          episodeRuntime,
          userStatus: s.userStatus,
          lastUpdated: Date.now(),
        };
        episodes += s.episodeKeys.size;
      } else {
        watchlist.push({ ...base, addedAt: Date.now() });
      }
    } catch (err) {
      unmatched.push({
        type: 'show',
        title: s.title,
        identifier: s.tvdbId != null ? String(s.tvdbId) : '',
        episodesWatched: s.episodeKeys.size,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      bump(s.title);
    }
  });

  await runPool([...movieTasks, ...showTasks], 8);

  onProgress?.({ processed: total, total, currentTitle: '' });
  return {
    shows,
    movies,
    watchlist,
    unmatched,
    counts: {
      movies: Object.keys(movies).length,
      shows: Object.keys(shows).length,
      episodes,
      watchlist: watchlist.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Report (CSV of items that couldn't be imported).
// ---------------------------------------------------------------------------

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildUnmatchedCsv(unmatched: UnmatchedItem[]): string {
  const header = 'type,title,identifier,episodes_watched,reason';
  const lines = unmatched.map((u) =>
    [
      u.type,
      csvField(u.title),
      csvField(u.identifier),
      String(u.episodesWatched),
      csvField(u.reason),
    ].join(','),
  );
  return [header, ...lines].join('\n');
}
