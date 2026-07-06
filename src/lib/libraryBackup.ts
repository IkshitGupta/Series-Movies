/**
 * Builds a MoviesSeriesHub data export.
 *
 * The export is written in the **same format the importer reads** (a ZIP of
 * `movies.json` + `series.json`, TV Time-compatible schema) so it round-trips
 * through the normal import flow. Each item additionally carries `id.tmdb` — our
 * canonical id — letting the importer resolve directly without a `/find` lookup.
 */
import { strToU8, zipSync } from 'fflate';

import type { TrackedShow, WatchedMovie, WatchlistItem } from '@/types';

export interface LibrarySnapshot {
  watchedMovies: Record<number, WatchedMovie>;
  trackedShows: Record<number, TrackedShow>;
  watchlist: WatchlistItem[];
}

interface ExportId {
  tmdb: number;
  imdb: string | null;
  tvdb: number | null;
}

interface ExportMovie {
  id: ExportId;
  title: string;
  year: number | null;
  watched_at: string | null;
  is_watched: boolean;
}

interface ExportEpisode {
  id: { tvdb: null; imdb: null };
  number: number;
  name: string;
  special: boolean;
  is_watched: boolean;
  watched_at: null;
  rewatch_count: number;
  watched_count: number;
}

interface ExportSeason {
  number: number;
  is_specials: boolean;
  episodes: ExportEpisode[];
}

interface ExportSeries {
  id: ExportId;
  title: string;
  status: string;
  _noEpisodeData: boolean;
  seasons: ExportSeason[];
}

function yearToNumber(year: string | null): number | null {
  if (!year) return null;
  const n = Number.parseInt(year, 10);
  return Number.isFinite(n) ? n : null;
}

function toIso(ms: number | null | undefined): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function makeId(tmdb: number): ExportId {
  return { tmdb, imdb: null, tvdb: null };
}

/** Map the app's manual watch state back to a TV Time-style status string. */
function reverseStatus(show: TrackedShow): string {
  if (show.userStatus === 'stopped') return 'stopped';
  if (show.userStatus === 'continue_later') return 'watch_later';
  return 'up_to_date';
}

/** Rebuild season/episode groups from `S{n}E{n}` watched-episode keys. */
function groupSeasons(watchedEpisodes: string[]): ExportSeason[] {
  const bySeason = new Map<number, number[]>();
  for (const key of watchedEpisodes) {
    const match = /^S(\d+)E(\d+)$/.exec(key);
    if (!match) continue;
    const season = Number(match[1]);
    const episode = Number(match[2]);
    const list = bySeason.get(season) ?? [];
    list.push(episode);
    bySeason.set(season, list);
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, episodes]) => ({
      number,
      is_specials: false,
      episodes: episodes
        .sort((a, b) => a - b)
        .map((n) => ({
          id: { tvdb: null, imdb: null },
          number: n,
          name: '',
          special: false,
          is_watched: true,
          watched_at: null,
          rewatch_count: 0,
          watched_count: 1,
        })),
    }));
}

/**
 * Build the export ZIP bytes for the current library. Watched movies/shows are
 * marked watched; watchlist items are emitted as unwatched (movies) or
 * not-started shows, so importing reconstructs the watchlist too.
 */
export function buildExportZip(snapshot: LibrarySnapshot): Uint8Array {
  const watchlistMovieIds = new Set<number>();
  const watchlistShowIds = new Set<number>();

  const movies: ExportMovie[] = Object.values(snapshot.watchedMovies).map((m) => ({
    id: makeId(m.id),
    title: m.title,
    year: yearToNumber(m.year),
    watched_at: toIso(m.watchedAt),
    is_watched: true,
  }));

  const series: ExportSeries[] = Object.values(snapshot.trackedShows).map((s) => ({
    id: makeId(s.id),
    title: s.title,
    status: reverseStatus(s),
    _noEpisodeData: false,
    seasons: groupSeasons(s.watchedEpisodes),
  }));

  for (const item of snapshot.watchlist) {
    if (item.mediaType === 'movie') {
      watchlistMovieIds.add(item.id);
      movies.push({
        id: makeId(item.id),
        title: item.title,
        year: yearToNumber(item.year),
        watched_at: null,
        is_watched: false,
      });
    } else {
      watchlistShowIds.add(item.id);
      series.push({
        id: makeId(item.id),
        title: item.title,
        status: 'not_started_yet',
        _noEpisodeData: false,
        seasons: [],
      });
    }
  }

  const files: Record<string, Uint8Array> = {
    'movies.json': strToU8(JSON.stringify(movies, null, 2)),
    'series.json': strToU8(JSON.stringify(series, null, 2)),
  };
  return zipSync(files, { level: 6 });
}

/** Whether there is anything worth exporting. */
export function isLibraryEmpty(snapshot: LibrarySnapshot): boolean {
  return (
    Object.keys(snapshot.watchedMovies).length === 0 &&
    Object.keys(snapshot.trackedShows).length === 0 &&
    snapshot.watchlist.length === 0
  );
}
