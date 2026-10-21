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
import { statusEpisodeTotal } from '@/lib/airing';
import { topCast } from '@/lib/normalize';
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
  /** ISO date the episode was watched. Present in our own exports; often absent
   * in real TV Time exports. */
  watched_at?: string | null;
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
  /** Watched date (epoch ms) per episode key, when the export carries one. */
  episodeWatchedAt: Record<string, number>;
  firstWatchedSeason: number | null;
  userStatus?: ShowUserStatus;
  hasWatched: boolean;
  /**
   * True when every numbered (non-special) episode the export lists for this show
   * is watched. Used to reconcile a fully-watched show to TMDB's episode set so a
   * TheTVDB↔TMDB numbering/count mismatch doesn't strand it in "Watching".
   */
  fullyWatchedInExport: boolean;
  /** Season numbers the export enumerates episodes for — used to avoid expanding
   * a fully-watched *single-season* TheTVDB entry across a multi-season TMDB show
   * (e.g. anime split into per-season TheTVDB series). */
  exportSeasonNumbers: number[];
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

/** A show TMDB considers finished — no further episodes will be added. */
function isEndedShow(status: string | undefined): boolean {
  return status === 'Ended' || status === 'Canceled';
}

/**
 * Every numbered (non-special) episode key TMDB knows for a show, derived from the
 * per-season `episode_count`. Used to reconcile a fully-watched import to TMDB's
 * numbering so a TheTVDB↔TMDB count mismatch doesn't leave it short of "Completed".
 */
function allTmdbEpisodeKeys(details: TmdbTvDetails): string[] {
  const keys: string[] = [];
  for (const season of details.seasons ?? []) {
    if (season.season_number < 1 || season.episode_count < 1) continue;
    for (let e = 1; e <= season.episode_count; e += 1) {
      keys.push(episodeKey(season.season_number, e));
    }
  }
  return keys;
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
    const parsed = JSON.parse(strFromU8(moviesRaw)) as unknown;
    const raw = Array.isArray(parsed) ? (parsed as TvTimeMovieRaw[]) : [];
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
    const parsed = JSON.parse(strFromU8(seriesRaw)) as unknown;
    const raw = Array.isArray(parsed) ? (parsed as TvTimeSeriesRaw[]) : [];
    for (const s of raw) {
      const episodeKeys = new Set<string>();
      const episodeWatchedAt: Record<string, number> = {};
      const exportSeasons = new Set<number>();
      let firstWatchedSeason: number | null = null;
      let numberedTotal = 0;
      let numberedWatched = 0;
      for (const season of s.seasons ?? []) {
        // Skip specials (season 0); the app tracks numbered episodes only.
        if (season.number < 1 || season.is_specials) continue;
        for (const ep of season.episodes ?? []) {
          if (ep.special) continue;
          numberedTotal += 1;
          exportSeasons.add(season.number);
          if (!ep.is_watched) continue;
          numberedWatched += 1;
          const key = episodeKey(season.number, ep.number);
          episodeKeys.add(key);
          const ms = toEpochMs(ep.watched_at ?? null);
          if (ms != null) episodeWatchedAt[key] = ms;
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
        episodeWatchedAt,
        firstWatchedSeason,
        userStatus: mapUserStatus(s.status),
        hasWatched: episodeKeys.size > 0,
        fullyWatchedInExport: numberedTotal > 0 && numberedWatched === numberedTotal,
        exportSeasonNumbers: [...exportSeasons],
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
        cast: topCast(d),
      };
      if (m.isWatched) {
        const watchedAt = m.watchedAt ?? Date.now();
        const existing = movies[movieId];
        // Two export entries can resolve to the same TMDB id — keep the earliest
        // watch date instead of letting whichever finishes last overwrite.
        movies[movieId] = existing
          ? { ...existing, watchedAt: Math.min(existing.watchedAt, watchedAt) }
          : { ...base, watchedAt, runtime: d.runtime ?? undefined };
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
        cast: topCast(d),
      };
      if (s.hasWatched) {
        const episodeRuntime = await resolveEpisodeRuntime(tmdbId, d, s.firstWatchedSeason);
        // Reconcile a fully-watched ended show to TMDB's episode set. The export's
        // TheTVDB numbering can yield fewer unique keys than TMDB's episode count
        // (episodes TMDB splits that TheTVDB merges), which would otherwise strand a
        // completed show in "Watching". Guards:
        //  - only ended shows (a returning show that's merely caught up must stay
        //    "Watching");
        //  - only TheTVDB-sourced shows (`tmdbId == null`): our own exports carry a
        //    TMDB id and emit *only* watched episodes, so `fullyWatchedInExport` is
        //    always true there and must not force-complete a partial round-trip;
        //  - only when the export enumerates *every* numbered TMDB season, so a
        //    single-season TheTVDB entry mapped onto a multi-season TMDB show
        //    (e.g. anime split into per-season series) isn't force-completed
        //    across seasons the export never covered;
        //  - never shrink the watched set.
        let watchedEpisodes = [...s.episodeKeys];
        const tmdbSeasons = d.seasons.filter((se) => se.season_number >= 1 && se.episode_count > 0);
        const covered = new Set(s.exportSeasonNumbers);
        const coversAllSeasons =
          tmdbSeasons.length > 0 && tmdbSeasons.every((se) => covered.has(se.season_number));
        if (s.fullyWatchedInExport && s.tmdbId == null && isEndedShow(d.status) && coversAllSeasons) {
          const full = allTmdbEpisodeKeys(d);
          if (full.length >= watchedEpisodes.length) watchedEpisodes = full;
        }
        const existing = shows[tmdbId];
        if (existing) {
          // Another export entry already resolved to this TMDB id (e.g. two
          // TheTVDB series that map to one TMDB show) — union their progress
          // instead of letting whichever request finishes last overwrite it.
          const union = new Set([...existing.watchedEpisodes, ...watchedEpisodes]);
          const before = existing.watchedEpisodes.length;
          shows[tmdbId] = {
            ...existing,
            watchedEpisodes: [...union],
            episodeWatchedAt: { ...existing.episodeWatchedAt, ...s.episodeWatchedAt },
            userStatus: existing.userStatus ?? s.userStatus,
            episodeRuntime: existing.episodeRuntime ?? episodeRuntime,
            lastUpdated: Date.now(),
          };
          episodes += union.size - before;
        } else {
          shows[tmdbId] = {
            ...base,
            watchedEpisodes,
            episodeWatchedAt:
              Object.keys(s.episodeWatchedAt).length > 0 ? { ...s.episodeWatchedAt } : undefined,
            totalEpisodes: statusEpisodeTotal(d),
            episodeRuntime,
            userStatus: s.userStatus,
            lastUpdated: Date.now(),
          };
          episodes += watchedEpisodes.length;
        }
      } else if (s.userStatus) {
        // A show with a manual status but no watched episodes ("Stopped watching"
        // / "Continue later") is tracked with that status — not demoted to the
        // watchlist, which would silently drop the status on an export round-trip.
        const existing = shows[tmdbId];
        if (!existing) {
          shows[tmdbId] = {
            ...base,
            watchedEpisodes: [],
            totalEpisodes: statusEpisodeTotal(d),
            userStatus: s.userStatus,
            lastUpdated: Date.now(),
          };
        } else if (!existing.userStatus) {
          shows[tmdbId] = { ...existing, userStatus: s.userStatus };
        }
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
