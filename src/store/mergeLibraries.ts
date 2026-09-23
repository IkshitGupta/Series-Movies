import {
  episodeTombstoneKey,
  mediaKey,
  type CastCredit,
  type Revivals,
  type Tombstones,
  type TrackedShow,
  type WatchedMovie,
  type WatchlistItem,
} from '@/types';
import { MAX_CAST } from '@/lib/normalize';

/**
 * Pure, dependency-free library merge used by the sync engine.
 *
 * Kept in its own module (no React-Native / store imports) so it is unit-
 * testable in isolation and free of side effects.
 *
 * **Semantics — offline-first, safe-merge (an LWW-element-set CRDT):**
 * - Watch marks are **unioned** so no mark is ever lost when two devices edit
 *   offline.
 * - Membership is decided by comparing, per element, its latest **add** time
 *   against its latest **remove** time ({@link Tombstones}). Both are max-merged
 *   and never erode, so the merge is **idempotent, commutative and associative**:
 *   a later re-add beats an older deletion and vice-versa, on every subsequent
 *   sync — not just the first one. Ties (which only arise from clamping) resolve
 *   to **keep** so a re-add is never lost.
 * - Non-eroding add times: movies use a dedicated {@link Revivals} marker (their
 *   `watchedAt` is min-merged for display and would erode); shows use
 *   `lastUpdated` (max-merged); episodes use `episodeWatchedAt` (max-merged per
 *   key); watchlist items use `addedAt` (dedup keeps the max).
 * - Untracking a show writes a per-episode tombstone for each episode it removes,
 *   so re-tracking starts fresh (old progress isn't resurrected). A genuinely new
 *   episode watched concurrently on another device has no such tombstone and so
 *   survives.
 * - All timestamps use a single `now` per merge and are bounded at
 *   `now + SKEW_TOLERANCE` (24h). This keeps the delete-vs-add ordering correct
 *   for any device within a day of real time (the realistic case: NTP keeps
 *   clocks within seconds). It does NOT fully tame a Byzantine clock: a device
 *   more than 24h off can still mis-resolve, and one stuck far in the future can
 *   keep an item un-deletable while it keeps syncing. A server-authoritative
 *   clock would be needed to close that gap; it's accepted as out of scope.
 */

export interface LibraryPayload {
  watchlist: WatchlistItem[];
  watchedMovies: Record<number, WatchedMovie>;
  trackedShows: Record<number, TrackedShow>;
  /** Deletion markers (optional for backward compatibility with old cloud rows). */
  tombstones?: Tombstones;
  /** Movie re-add markers (optional; see {@link Revivals}). */
  revivals?: Revivals;
}

/** How long a marker is honored before it's garbage-collected. */
const TTL_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

/** Clock-skew tolerance for the future-clamp. Timestamps are clamped to
 * `now + this` (not a razor `now`): a merging device whose clock LAGS the writer
 * would otherwise clamp both a delete and the add it removes down to its own
 * `now`, collapsing them to equal and (with the add-wins `>` tie-break) losing
 * the delete. Anything within a day of real time keeps its true value so the
 * delete-vs-add ordering is preserved; only genuinely broken clocks are bounded. */
const SKEW_TOLERANCE_MS = 1000 * 60 * 60 * 24; // 24 hours

function num(v: number | undefined): number {
  return typeof v === 'number' ? v : 0;
}

/** Merge one category of timestamp markers: max per key, GC old, clamp far-future. */
function mergeStampMap(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
  clampCeil: number,
  cutoff: number,
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const src of [a, b]) {
    if (!src) continue;
    for (const [key, ts] of Object.entries(src)) {
      if (typeof ts !== 'number') continue;
      // Bound a far-future timestamp (clock skew) so it can't stay unbeatable,
      // but leave anything within the tolerance untouched (see SKEW_TOLERANCE_MS).
      const clamped = Math.min(ts, clampCeil);
      if (clamped < cutoff) continue; // GC markers past the retention window
      if (!(key in merged) || clamped > merged[key]) merged[key] = clamped;
    }
  }
  return merged;
}

function mergeTombstones(
  a: Tombstones | undefined,
  b: Tombstones | undefined,
  clampCeil: number,
  cutoff: number,
): Tombstones {
  return {
    movies: mergeStampMap(a?.movies, b?.movies, clampCeil, cutoff),
    shows: mergeStampMap(a?.shows, b?.shows, clampCeil, cutoff),
    showStatus: mergeStampMap(a?.showStatus, b?.showStatus, clampCeil, cutoff),
    watchlist: mergeStampMap(a?.watchlist, b?.watchlist, clampCeil, cutoff),
    episodes: mergeStampMap(a?.episodes, b?.episodes, clampCeil, cutoff),
  };
}

function mergeRevivals(
  a: Revivals | undefined,
  b: Revivals | undefined,
  clampCeil: number,
  cutoff: number,
): Revivals {
  return {
    movies: mergeStampMap(a?.movies, b?.movies, clampCeil, cutoff),
    episodes: mergeStampMap(a?.episodes, b?.episodes, clampCeil, cutoff),
    showStatus: mergeStampMap(a?.showStatus, b?.showStatus, clampCeil, cutoff),
  };
}

/** Merge two cast lists symmetrically. Prefer a non-empty side so an empty `[]`
 * (written when a title 404s on TMDB during backfill) can never wipe a real cast
 * another device fetched. Then prefer a **current-era** cast (one that fits within
 * `MAX_CAST`) over a **legacy** one that exceeds it: an older, larger cap stored
 * up to 15 members, and "longer wins" alone would let that stale list revert a
 * migration to today's fewer, better-selected members. Among casts of the same
 * era, prefer the more complete list (TMDB can grow a title's credits over time),
 * then an id+name tiebreak. Order-independent → commutative. */
const castKey = (c?: CastCredit[]) => (c ?? []).map((x) => `${x.id}\u0000${x.name}`).join('\u0001');
function pickCast(a?: CastCredit[], b?: CastCredit[]): CastCredit[] | undefined {
  if (!a || a.length === 0) return b ?? a;
  if (!b || b.length === 0) return a;
  const aLegacy = a.length > MAX_CAST;
  const bLegacy = b.length > MAX_CAST;
  if (aLegacy !== bLegacy) return aLegacy ? b : a;
  if (a.length !== b.length) return a.length > b.length ? a : b;
  return castKey(a) <= castKey(b) ? a : b;
}

/** Union two per-season cast maps, resolving each season with `pickCast` so the
 * result is order-independent (commutative) and empty/short seasons never wipe a
 * fetched one. Absent on a side → keep the other side. */
function mergeCastBySeason(
  a?: Record<number, CastCredit[]>,
  b?: Record<number, CastCredit[]>,
): Record<number, CastCredit[]> | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: Record<number, CastCredit[]> = {};
  const seasons = new Set<number>([...Object.keys(a), ...Object.keys(b)].map(Number));
  for (const s of seasons) {
    const picked = pickCast(a[s], b[s]);
    if (picked) out[s] = picked;
  }
  return out;
}

/** Deterministic, symmetric rank of a movie's display fields, so two devices
 * with divergent metadata (e.g. a locale/fetch-time title variant) converge on
 * the same winner instead of each keeping its own and ping-ponging every sync. */
function movieRank(x: WatchedMovie): string {
  return [
    x.title ?? '',
    x.year ?? '',
    x.posterPath ?? '',
    x.runtime ?? '',
    (x.genres ?? []).join(','),
    (x.cast ?? []).map((c) => c.id).join(','),
  ].join('\u0000');
}

/** Union two watched-movie maps, keeping the earliest watched timestamp and
 * resolving display fields symmetrically (like `mergeShows`) so the merge is
 * commutative and metadata converges instead of flipping on every sync. */
function mergeMovies(
  local: Record<number, WatchedMovie>,
  remote: Record<number, WatchedMovie>,
): Record<number, WatchedMovie> {
  const out: Record<number, WatchedMovie> = { ...remote };
  for (const m of Object.values(local)) {
    const other = out[m.id];
    if (!other) {
      out[m.id] = m;
      continue;
    }
    const winner = movieRank(m) <= movieRank(other) ? m : other;
    const loser = winner === m ? other : m;
    out[m.id] = {
      ...loser,
      ...winner,
      watchedAt: Math.min(other.watchedAt, m.watchedAt),
      // Keep whichever side has each optional value so a fetch/backfill on one
      // device isn't dropped just because the winner hasn't got it yet.
      cast: pickCast(winner.cast, loser.cast),
      runtime: winner.runtime ?? loser.runtime,
      genres: winner.genres ?? loser.genres,
      posterPath: winner.posterPath ?? loser.posterPath,
      year: winner.year ?? loser.year,
    };
  }
  return out;
}

/** Per-key max of two epoch-ms records (non-eroding). */
function maxMergeRecord(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    if (!(k in out) || v > out[k]) out[k] = v;
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
    // The side edited most recently wins the manual/scalar fields. On an exact
    // `lastUpdated` tie (same-ms edit, both-zero legacy, or two values clamped to
    // the same ceiling) break it deterministically & symmetrically so the merge
    // is commutative — otherwise each device keeps its own scalar and they
    // ping-pong forever. Tie order is by `title` alone: `userStatus` is resolved
    // separately by its own register below, so it must not skew this choice.
    const lu = l.lastUpdated ?? 0;
    const ru = r.lastUpdated ?? 0;
    const lKey = l.title ?? '';
    const rKey = r.title ?? '';
    const newer = lu !== ru ? (lu > ru ? l : r) : lKey <= rKey ? l : r;
    const older = newer === l ? r : l;
    out[l.id] = {
      ...older,
      ...newer,
      watchedEpisodes: [...union],
      // Per-key max so an episode's watch time (used as its add time by the
      // membership check) does not erode across successive merges.
      episodeWatchedAt: maxMergeRecord(older.episodeWatchedAt, newer.episodeWatchedAt),
      // Explicit so a cleared (undefined) status on the newer side is NOT
      // resurrected from the older side by the object spread above.
      userStatus: newer.userStatus,
      // Keep whichever side has each optional metadata value so a fetch/backfill
      // on one device isn't dropped just because the newer side hasn't got it yet.
      cast: pickCast(newer.cast, older.cast),
      castBySeason: mergeCastBySeason(newer.castBySeason, older.castBySeason),
      totalEpisodes: newer.totalEpisodes || older.totalEpisodes,
      airedEpisodes: newer.airedEpisodes ?? older.airedEpisodes,
      episodeRuntime: newer.episodeRuntime ?? older.episodeRuntime,
      genres: newer.genres ?? older.genres,
      // Resolve the remaining display fields symmetrically too, so a `lastUpdated`
      // tie can't leave them device-local (and ping-ponging on every sync).
      posterPath: newer.posterPath ?? older.posterPath,
      year: newer.year ?? older.year,
      lastUpdated: Math.max(l.lastUpdated ?? 0, r.lastUpdated ?? 0),
    };
  }
  return out;
}

/** Union two watchlists (dedup by media, keeping the newest `addedAt`), dropping
 * items now watched/tracked. Order-independent (sorted newest-first). */
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
  const byKey = new Map<string, WatchlistItem>();
  for (const item of [...local, ...remote]) {
    if (isWatchedOrTracked(item.mediaType, item.id)) continue;
    const key = mediaKey(item.mediaType, item.id);
    const existing = byKey.get(key);
    // Keep the newest add so `addedAt` (the membership add-time) never erodes.
    if (!existing || item.addedAt > existing.addedAt) byKey.set(key, item);
  }
  return [...byKey.values()].sort(
    (a, b) => b.addedAt - a.addedAt || a.id - b.id || a.mediaType.localeCompare(b.mediaType),
  );
}

/** True when a removal marker strictly newer than the item's add time removes
 * it. Ties (`tomb === addTime`) resolve to **keep** — with timestamps bounded at
 * `now + SKEW_TOLERANCE` a tie only arises from an extreme (>24h) clock skew, and
 * keeping a re-add there is the safer resolution. A genuine delete lands a
 * strictly later ms than the add it removes, so real deletes still win. */
function removedByTomb(tomb: number | undefined, addTime: number): boolean {
  return tomb != null && tomb > addTime;
}

/** Clamp a show's stored membership timestamps to `clampCeil` so a badly-skewed
 * device's values don't persist (and stay un-deletable) across future merges. */
function clampShow(s: TrackedShow, clampCeil: number): TrackedShow {
  const lu = Math.min(s.lastUpdated ?? 0, clampCeil);
  let ewa = s.episodeWatchedAt;
  let ewaChanged = false;
  if (ewa) {
    for (const k of Object.keys(ewa)) {
      if (ewa[k] > clampCeil) {
        if (!ewaChanged) {
          ewa = { ...s.episodeWatchedAt };
          ewaChanged = true;
        }
        ewa[k] = clampCeil;
      }
    }
  }
  if (lu === s.lastUpdated && !ewaChanged) return s;
  return { ...s, lastUpdated: lu, episodeWatchedAt: ewa };
}

/** Combine the local library with a pulled cloud snapshot (see notes above). */
export function mergeLibraries(local: LibraryPayload, remote: LibraryPayload): LibraryPayload {
  // A single `now` for the whole merge so clamping is deterministic. Timestamps
  // are bounded at `now + SKEW_TOLERANCE` (not a razor `now`) so a merging device
  // whose clock merely lags the writer keeps the true delete-vs-add ordering.
  const now = Date.now();
  const clampCeil = now + SKEW_TOLERANCE_MS;
  const cutoff = now - TTL_MS;
  const tombstones = mergeTombstones(local.tombstones, remote.tombstones, clampCeil, cutoff);
  const revivals = mergeRevivals(local.revivals, remote.revivals, clampCeil, cutoff);
  const addAt = (v: number | undefined) => Math.min(num(v), clampCeil);

  // --- Movies: present unless a tombstone is newer than the (clamped) add time. ---
  const watchedMovies = mergeMovies(local.watchedMovies, remote.watchedMovies);
  for (const idStr of Object.keys(watchedMovies)) {
    const id = Number(idStr);
    if (removedByTomb(tombstones.movies[id], addAt(revivals.movies[id]))) delete watchedMovies[id];
  }

  // --- Shows + episodes. ---
  const trackedShows = mergeShows(local.trackedShows, remote.trackedShows);
  for (const idStr of Object.keys(trackedShows)) {
    const id = Number(idStr);
    const show = trackedShows[id];
    // Whole-show removal: add time is the max `lastUpdated` seen on either side.
    // A concurrent edit/re-add (newer than the untrack) keeps the show alive.
    const showAddTime = Math.max(
      addAt(local.trackedShows[id]?.lastUpdated),
      addAt(remote.trackedShows[id]?.lastUpdated),
    );
    if (removedByTomb(tombstones.shows[id], showAddTime)) {
      // Tombstone each episode removed with the show (at the show tombstone's own
      // time — deterministic, so idempotent) so a stale device that still holds
      // one can't resurrect it after a re-track. A genuinely newer watch wins.
      const st = tombstones.shows[id];
      for (const key of show.watchedEpisodes) {
        const tk = episodeTombstoneKey(id, key);
        if (!(tk in tombstones.episodes) || st > tombstones.episodes[tk]) tombstones.episodes[tk] = st;
      }
      delete trackedShows[id];
      continue;
    }
    // The manual status is a per-field LWW register keyed on the SET time
    // (`revivals.showStatus`) and CLEAR time (`tombstones.showStatus`), so it's
    // resolved independently of the show's `lastUpdated` (which unrelated episode
    // edits on another device bump). The later set wins the value; a still-newer
    // clear then forces it to undefined.
    let userStatus = show.userStatus;
    const lSet = num(local.revivals?.showStatus?.[id]);
    const rSet = num(remote.revivals?.showStatus?.[id]);
    if (lSet !== rSet) {
      // Only override when the newer-set side actually still holds the show; if
      // it untracked it (no record), keep the surviving show's own status rather
      // than nulling it from a side that has nothing.
      const winner = lSet > rSet ? local.trackedShows[id] : remote.trackedShows[id];
      if (winner) userStatus = winner.userStatus;
    }
    if (removedByTomb(tombstones.showStatus[id], addAt(revivals.showStatus[id]))) userStatus = undefined;
    // Episodes: dropped by their own tombstone (written when an episode is
    // un-ticked). An episode re-watched after that removal (newer `episodeWatchedAt`)
    // survives; a concurrent *new* episode on another device has no tombstone.
    // An imported episode's revival marker lets it beat a stale tombstone despite
    // its historical (old) watch date.
    const localAt = local.trackedShows[id]?.episodeWatchedAt;
    const remoteAt = remote.trackedShows[id]?.episodeWatchedAt;
    const kept = show.watchedEpisodes.filter((key) => {
      const tKey = episodeTombstoneKey(id, key);
      const tomb = tombstones.episodes[tKey];
      if (tomb == null) return true;
      const addTime = Math.max(
        addAt(localAt?.[key]),
        addAt(remoteAt?.[key]),
        addAt(revivals.episodes[tKey]),
      );
      return !removedByTomb(tomb, addTime);
    });
    if (kept.length !== show.watchedEpisodes.length || userStatus !== show.userStatus) {
      const keptSet = new Set(kept);
      const episodeWatchedAt = { ...show.episodeWatchedAt };
      for (const key of show.watchedEpisodes) {
        if (!keptSet.has(key)) delete episodeWatchedAt[key];
      }
      trackedShows[id] = { ...show, watchedEpisodes: kept, episodeWatchedAt, userStatus };
    }
    // A show with no episode progress and no manual status is no longer tracked —
    // checked unconditionally (not only when episodes changed) so a show that
    // arrives already empty with its status cleared above is pruned too.
    const merged = trackedShows[id];
    if (merged.watchedEpisodes.length === 0 && !merged.userStatus) {
      delete trackedShows[id];
      continue;
    }
    // Clamp stored timestamps so a badly-skewed value can't persist and keep
    // beating a real tombstone forever (a later deletion then removes it).
    trackedShows[id] = clampShow(merged, clampCeil);
  }

  // --- Watchlist: present unless a tombstone is newer than the (clamped) addedAt. ---
  let watchlist = mergeWatchlist(local.watchlist, remote.watchlist, watchedMovies, trackedShows);
  if (Object.keys(tombstones.watchlist).length > 0) {
    watchlist = watchlist.filter(
      (w) => !removedByTomb(tombstones.watchlist[mediaKey(w.mediaType, w.id)], addAt(w.addedAt)),
    );
  }
  // Clamp stored `addedAt` for the same reason as shows above.
  watchlist = watchlist.map((w) => (w.addedAt > clampCeil ? { ...w, addedAt: clampCeil } : w));

  return { watchlist, watchedMovies, trackedShows, tombstones, revivals };
}
