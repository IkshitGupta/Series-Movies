import type { TrackedShow, WatchedMovie, WatchlistItem } from '@/types';

/**
 * Pure, dependency-free library merge used by the sync engine.
 *
 * Kept in its own module (no React-Native / store imports) so it is unit-
 * testable in isolation and free of side effects.
 *
 * **Semantics — offline-first, safe-merge:**
 * - Watch marks (watched episodes/movies and watchlist entries) are **unioned**
 *   so no mark is ever lost when two devices edit offline.
 * - A show's *manual* state — the `userStatus` chip ("Stopped watching" /
 *   "Continue later"), which the user can change or clear — is resolved
 *   **newest-wins** by each show's `lastUpdated` (bumped on every local edit).
 *   A plain union (cloud-wins) would revert a local status change/clear on the
 *   next sync, so the scalar must track the most recent edit instead.
 */

export interface LibraryPayload {
  watchlist: WatchlistItem[];
  watchedMovies: Record<number, WatchedMovie>;
  trackedShows: Record<number, TrackedShow>;
}

/** Union two watched-movie maps, keeping the earliest watched timestamp. */
function mergeMovies(
  local: Record<number, WatchedMovie>,
  remote: Record<number, WatchedMovie>,
): Record<number, WatchedMovie> {
  const out: Record<number, WatchedMovie> = { ...remote };
  for (const m of Object.values(local)) {
    const other = out[m.id];
    out[m.id] = other
      ? { ...other, ...m, watchedAt: Math.min(other.watchedAt, m.watchedAt) }
      : m;
  }
  return out;
}

/** Merge two tracked-show maps: union episodes, newest-wins for scalar state. */
function mergeShows(
  local: Record<number, TrackedShow>,
  remote: Record<number, TrackedShow>,
): Record<number, TrackedShow> {
  const out: Record<number, TrackedShow> = { ...remote };
  for (const l of Object.values(local)) {
    const r = out[l.id];
    if (!r) {
      out[l.id] = l;
      continue;
    }
    const union = new Set([...r.watchedEpisodes, ...l.watchedEpisodes]);
    // The side edited most recently wins the manual/scalar fields.
    const newer = (l.lastUpdated ?? 0) >= (r.lastUpdated ?? 0) ? l : r;
    const older = newer === l ? r : l;
    out[l.id] = {
      ...older,
      ...newer,
      watchedEpisodes: [...union],
      episodeWatchedAt: { ...older.episodeWatchedAt, ...newer.episodeWatchedAt },
      // Explicit so a cleared (undefined) status on the newer side is NOT
      // resurrected from the older side by the object spread above.
      userStatus: newer.userStatus,
      lastUpdated: Math.max(l.lastUpdated ?? 0, r.lastUpdated ?? 0),
    };
  }
  return out;
}

/** Union two watchlists (dedup by media), dropping items now watched/tracked. */
function mergeWatchlist(
  local: WatchlistItem[],
  remote: WatchlistItem[],
  movies: Record<number, WatchedMovie>,
  shows: Record<number, TrackedShow>,
): WatchlistItem[] {
  const watchedMovieIds = new Set(Object.keys(movies).map(Number));
  const trackedShowIds = new Set(Object.keys(shows).map(Number));
  const isWatchedOrTracked = (mediaType: WatchlistItem['mediaType'], id: number) =>
    (mediaType === 'movie' && watchedMovieIds.has(id)) ||
    (mediaType === 'tv' && trackedShowIds.has(id));
  const seen = new Set<string>();
  const out: WatchlistItem[] = [];
  // Local first (usually the most recent ordering), then remote-only items.
  for (const item of [...local, ...remote]) {
    const key = `${item.mediaType}-${item.id}`;
    if (seen.has(key) || isWatchedOrTracked(item.mediaType, item.id)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Combine the local library with a pulled cloud snapshot (see notes above). */
export function mergeLibraries(local: LibraryPayload, remote: LibraryPayload): LibraryPayload {
  const watchedMovies = mergeMovies(local.watchedMovies, remote.watchedMovies);
  const trackedShows = mergeShows(local.trackedShows, remote.trackedShows);
  const watchlist = mergeWatchlist(local.watchlist, remote.watchlist, watchedMovies, trackedShows);
  return { watchlist, watchedMovies, trackedShows };
}
