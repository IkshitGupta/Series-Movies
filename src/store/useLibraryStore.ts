import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { zustandStorage } from '@/store/storage';
import { MAX_CAST } from '@/lib/normalize';
import {
  emptyRevivals,
  emptyTombstones,
  episodeKey,
  episodeTombstoneKey,
  mediaKey,
  seasonFromEpisodeKey,
  type CastCredit,
  type MediaItem,
  type Revivals,
  type ShowStatus,
  type ShowUserStatus,
  type ThemePref,
  type Tombstones,
  type TrackedShow,
  type WatchedMovie,
  type WatchlistItem,
} from '@/types';

/** TMDB-derived episode totals for a tracked show (see `syncShowMeta`). */
type ShowMetaUpdate = { totalEpisodes?: number; airedEpisodes?: number };

interface LibraryState {
  /** Single "To Watch" list (movies + shows mixed), newest first. */
  watchlist: WatchlistItem[];
  /** Watched movies keyed by TMDB movie id. */
  watchedMovies: Record<number, WatchedMovie>;
  /** Tracked shows (with per-episode progress) keyed by TMDB show id. */
  trackedShows: Record<number, TrackedShow>;
  /** Deletion markers so removals survive the offline-first sync merge instead
   * of being resurrected by a stale cloud copy. */
  tombstones: Tombstones;
  /** Addition markers (movies + imported episodes) whose own content timestamp
   * isn't a reliable "added at" time; paired with {@link tombstones} to make the
   * merge an idempotent LWW-element-set. */
  revivals: Revivals;
  /** Whether the one-time first-launch onboarding has been completed. */
  onboarded: boolean;
  /** Appearance preference (System / Light / Dark). */
  theme: ThemePref;
  /** Supabase user id whose library is currently loaded on this device, or null
   * when the library is anonymous (never signed in). Device-local bookkeeping —
   * never uploaded — used to keep two accounts' libraries from mixing. */
  ownerId: string | null;
  /** Device-local marker of which cast-selection rule the stored cast was built
   * with. Bumped when the rule changes so the backfill re-fetches every title's
   * cast once. Never synced (each device migrates its own cache). */
  castRuleVersion?: number;

  // --- Appearance ---
  setTheme: (theme: ThemePref) => void;

  // --- Account sync ---
  /** Record which account this device's library belongs to. */
  setOwner: (userId: string | null) => void;
  /** Replace the whole library (watchlist + movies + shows + tombstones) in one
   * shot. Used by the sync engine when applying a merged snapshot, and when
   * switching to a different account (start from empty, then pull that account's
   * cloud data). */
  replaceLibrary: (payload: {
    watchlist: WatchlistItem[];
    watchedMovies: Record<number, WatchedMovie>;
    trackedShows: Record<number, TrackedShow>;
    tombstones?: Tombstones;
    revivals?: Revivals;
  }) => void;

  // --- Onboarding / import ---
  setOnboarded: (value: boolean) => void;
  /** Merge an imported library (movies + shows + watchlist) into local state. */
  importLibrary: (payload: {
    shows: Record<number, TrackedShow>;
    movies: Record<number, WatchedMovie>;
    watchlist: WatchlistItem[];
  }) => void;

  // --- Watchlist ---
  addToWatchlist: (item: MediaItem) => void;
  removeFromWatchlist: (mediaType: MediaItem['mediaType'], id: number) => void;

  // --- Movies ---
  markMovieWatched: (item: MediaItem) => void;
  unmarkMovieWatched: (id: number) => void;
  /** Store a watched movie's runtime (minutes) for total watch-time stats. */
  setMovieRuntime: (id: number, runtime: number) => void;

  // --- Shows (per-episode) ---
  toggleEpisode: (
    item: MediaItem,
    totalEpisodes: number,
    seasonNumber: number,
    episodeNumber: number,
  ) => void;
  setSeasonEpisodes: (
    item: MediaItem,
    totalEpisodes: number,
    seasonNumber: number,
    episodeNumbers: number[],
    watched: boolean,
  ) => void;
  /** Mark a specific set of episode keys as watched (union with existing progress). */
  markEpisodesWatched: (item: MediaItem, totalEpisodes: number, keys: string[]) => void;
  /** Set (or clear with null) the manual watch state for a show. */
  setShowStatus: (
    item: MediaItem,
    totalEpisodes: number,
    status: ShowUserStatus | null,
  ) => void;
  /** Store a tracked show's typical episode runtime (minutes) for watch-time stats. */
  setShowEpisodeRuntime: (id: number, runtime: number) => void;
  /** Keep a tracked show's episode totals in sync with TMDB (new season aired, or
   * newly-aired episodes changing the released count). */
  syncShowMeta: (id: number, meta: ShowMetaUpdate) => void;
  /** Bulk {@link syncShowMeta}: applies every change in one store write, and none
   * at all when nothing changed (each persisted write re-serializes the library). */
  syncShowsMeta: (updates: ({ id: number } & ShowMetaUpdate)[]) => void;

  // --- Cast backfill ---
  /** Set/replace the stored top cast for an existing watched movie or tracked
   * show (used by the one-time cast backfill). No-op if the item isn't present. */
  setItemCast: (mediaType: MediaItem['mediaType'], id: number, cast: CastCredit[]) => void;
  /** Bulk variant of {@link setItemCast} — applies many cast updates in a single
   * store write so a large backfill doesn't trigger O(N) re-renders/serializations. */
  setItemsCast: (
    updates: { mediaType: MediaItem['mediaType']; id: number; cast: CastCredit[] }[],
  ) => void;
  /** Bulk-set a tracked show's per-season cast (`castBySeason[season]`), used by
   * the cast backfill to attribute the actor stat to watched seasons only.
   * Merges into any existing seasons; no-op for shows that aren't present. */
  setSeasonCasts: (updates: { showId: number; season: number; cast: CastCredit[] }[]) => void;
  /** Record that the stored cast is now built with the given selection-rule
   * version (set by the backfill once a re-selection pass completes). */
  setCastRuleVersion: (version: number) => void;
}

function isSame(item: WatchlistItem, mediaType: MediaItem['mediaType'], id: number): boolean {
  return item.mediaType === mediaType && item.id === id;
}

/**
 * Strip display-only fields before an item is persisted/synced. `releaseDate`
 * rides on list items purely to render the "unreleased" badge (computed from
 * fresh TMDB data) — it must never enter the library: the CRDT merge doesn't
 * track it, so a stale/divergent snapshot could ping-pong across devices (and an
 * older app version's merge could clobber a real date with `null`).
 */
function toStored(item: MediaItem): MediaItem {
  if (item.releaseDate === undefined) return item;
  const rest = { ...item };
  delete rest.releaseDate;
  return rest;
}

function ensureTracked(
  shows: Record<number, TrackedShow>,
  item: MediaItem,
  totalEpisodes: number,
): TrackedShow {
  const existing = shows[item.id];
  if (existing) {
    return {
      ...existing,
      totalEpisodes: totalEpisodes || existing.totalEpisodes,
      // Backfill genres/cast if the show was first tracked before they were
      // stored; a real cast beats a stored empty `[]` (from a 404 backfill).
      genres: existing.genres ?? item.genres,
      cast: existing.cast?.length ? existing.cast : (item.cast ?? existing.cast),
    };
  }
  return {
    ...toStored(item),
    mediaType: 'tv',
    watchedEpisodes: [],
    totalEpisodes,
    lastUpdated: Date.now(),
  };
}

/** Record one or more timestamp markers (immutably) on a tombstone/revival set. */
function addStamps<T extends object>(
  stamps: T,
  category: keyof T,
  keys: (string | number)[],
  ts = Date.now(),
): T {
  if (keys.length === 0) return stamps;
  const next: Record<string, number> = { ...(stamps[category] as unknown as Record<string, number>) };
  for (const key of keys) next[String(key)] = ts;
  return { ...stamps, [category]: next } as T;
}

/** How long deletion/addition markers are retained (mirrors the merge's TTL). */
const MARKER_TTL_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

/** Drop marker entries older than `cutoff` (used to GC on rehydrate). */
function pruneStampMap(
  m: Record<string, number> | undefined,
  cutoff: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    if (typeof v === 'number' && v >= cutoff) out[k] = v;
  }
  return out;
}

/** Total number of marker entries across a tombstone/revival set. */
function stampCount(stamps: object | undefined): number {
  let n = 0;
  for (const m of Object.values(stamps ?? {})) {
    if (m && typeof m === 'object') n += Object.keys(m).length;
  }
  return n;
}

/** Prune a full tombstone/revival set of entries older than `cutoff`. */
function pruneTombstones(t: Tombstones | undefined, cutoff: number): Tombstones {
  return {
    movies: pruneStampMap(t?.movies, cutoff),
    shows: pruneStampMap(t?.shows, cutoff),
    showStatus: pruneStampMap(t?.showStatus, cutoff),
    watchlist: pruneStampMap(t?.watchlist, cutoff),
    episodes: pruneStampMap(t?.episodes, cutoff),
  };
}
function pruneRevivals(r: Revivals | undefined, cutoff: number): Revivals {
  return {
    movies: pruneStampMap(r?.movies, cutoff),
    episodes: pruneStampMap(r?.episodes, cutoff),
    showStatus: pruneStampMap(r?.showStatus, cutoff),
  };
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      watchlist: [],
      watchedMovies: {},
      trackedShows: {},
      tombstones: emptyTombstones(),
      revivals: emptyRevivals(),
      onboarded: false,
      theme: 'system',
      ownerId: null,

      setTheme: (theme) => set({ theme }),

      setOwner: (userId) => set({ ownerId: userId }),

      replaceLibrary: ({ watchlist, watchedMovies, trackedShows, tombstones, revivals }) =>
        set((state) => ({
          watchlist,
          watchedMovies,
          trackedShows,
          tombstones: tombstones ?? state.tombstones,
          revivals: revivals ?? state.revivals,
        })),

      setOnboarded: (value) => set({ onboarded: value }),

      importLibrary: ({ shows, movies, watchlist }) =>
        set((state) => {
          // Merge tracked shows: union episodes, refresh metadata. Prefer the
          // imported manual status, else keep whatever the user already had.
          const mergedShows = { ...state.trackedShows };
          for (const incoming of Object.values(shows)) {
            const existing = mergedShows[incoming.id];
            if (existing) {
              const union = new Set([...existing.watchedEpisodes, ...incoming.watchedEpisodes]);
              mergedShows[incoming.id] = {
                ...existing,
                ...incoming,
                watchedEpisodes: [...union],
                // Merge watched dates; keep the existing (usually earlier) stamp on conflict.
                episodeWatchedAt: { ...incoming.episodeWatchedAt, ...existing.episodeWatchedAt },
                userStatus: incoming.userStatus ?? existing.userStatus,
                lastUpdated: Date.now(),
              };
            } else {
              mergedShows[incoming.id] = { ...incoming, lastUpdated: Date.now() };
            }
          }

          // Merge watched movies: keep the earliest watched timestamp.
          const mergedMovies = { ...state.watchedMovies };
          for (const incoming of Object.values(movies)) {
            const existing = mergedMovies[incoming.id];
            mergedMovies[incoming.id] = existing
              ? { ...existing, ...incoming, watchedAt: Math.min(existing.watchedAt, incoming.watchedAt) }
              : incoming;
          }

          // Watchlist: add imported items that aren't already watched/tracked or
          // already listed, and drop any now-watched/tracked items from the list.
          const watchedMovieIds = new Set(Object.keys(mergedMovies).map(Number));
          const trackedShowIds = new Set(Object.keys(mergedShows).map(Number));
          const isWatchedOrTracked = (mediaType: MediaItem['mediaType'], id: number) =>
            (mediaType === 'movie' && watchedMovieIds.has(id)) ||
            (mediaType === 'tv' && trackedShowIds.has(id));

          const cleanedExisting = state.watchlist.filter(
            (w) => !isWatchedOrTracked(w.mediaType, w.id),
          );
          const seen = new Set(cleanedExisting.map((w) => `${w.mediaType}-${w.id}`));
          const additions: WatchlistItem[] = [];
          for (const item of watchlist) {
            const key = `${item.mediaType}-${item.id}`;
            if (seen.has(key) || isWatchedOrTracked(item.mediaType, item.id)) continue;
            seen.add(key);
            additions.push(item);
          }

          return {
            trackedShows: mergedShows,
            watchedMovies: mergedMovies,
            watchlist: [...additions, ...cleanedExisting],
            // An explicit import re-adds these items; stamp them as freshly added
            // so a stale cloud tombstone (e.g. from a prior untrack) can't strip
            // them out on the next merge. Movies carry a historical `watchedAt`,
            // and imported episodes carry a historical `episodeWatchedAt`, so both
            // need a revival marker; shows use lastUpdated=now and watchlist items
            // addedAt=now (both set above).
            revivals: (() => {
              let r = addStamps(state.revivals, 'movies', Object.keys(movies).map(Number));
              const epKeys: string[] = [];
              const statusShowIds: number[] = [];
              for (const s of Object.values(shows)) {
                for (const k of s.watchedEpisodes) epKeys.push(episodeTombstoneKey(s.id, k));
                if (s.userStatus) statusShowIds.push(s.id);
              }
              r = addStamps(r, 'episodes', epKeys);
              // An imported manual status beats a stale clear tombstone.
              r = addStamps(r, 'showStatus', statusShowIds);
              return r;
            })(),
          };
        }),

      addToWatchlist: (item) =>
        set((state) => {
          if (state.watchlist.some((w) => isSame(w, item.mediaType, item.id))) return state;
          return {
            watchlist: [{ ...toStored(item), addedAt: Date.now() }, ...state.watchlist],
          };
        }),

      removeFromWatchlist: (mediaType, id) =>
        set((state) => ({
          watchlist: state.watchlist.filter((w) => !isSame(w, mediaType, id)),
          tombstones: addStamps(state.tombstones, 'watchlist', [mediaKey(mediaType, id)]),
        })),

      markMovieWatched: (item) =>
        set((state) => {
          const now = Date.now();
          const wasListed = state.watchlist.some((w) => isSame(w, 'movie', item.id));
          return {
            watchedMovies: {
              ...state.watchedMovies,
              [item.id]: { ...toStored(item), mediaType: 'movie', watchedAt: now },
            },
            watchlist: wasListed
              ? state.watchlist.filter((w) => !isSame(w, 'movie', item.id))
              : state.watchlist,
            // Non-eroding "added at" marker so a stale un-mark tombstone can't
            // drop this on a later merge.
            revivals: addStamps(state.revivals, 'movies', [item.id], now),
            // Moving a listed item to "watched" implicitly removes it from the
            // watchlist — tombstone that so it can't resurrect from another device.
            tombstones: wasListed
              ? addStamps(state.tombstones, 'watchlist', [mediaKey('movie', item.id)], now)
              : state.tombstones,
          };
        }),

      unmarkMovieWatched: (id) =>
        set((state) => {
          const next = { ...state.watchedMovies };
          delete next[id];
          return {
            watchedMovies: next,
            tombstones: addStamps(state.tombstones, 'movies', [id]),
          };
        }),

      setMovieRuntime: (id, runtime) =>
        set((state) => {
          const movie = state.watchedMovies[id];
          if (!movie || movie.runtime === runtime) return state;
          return {
            watchedMovies: { ...state.watchedMovies, [id]: { ...movie, runtime } },
          };
        }),

      toggleEpisode: (item, totalEpisodes, seasonNumber, episodeNumber) =>
        set((state) => {
          const now = Date.now();
          const show = ensureTracked(state.trackedShows, item, totalEpisodes);
          const key = episodeKey(seasonNumber, episodeNumber);
          const has = show.watchedEpisodes.includes(key);
          const watchedEpisodes = has
            ? show.watchedEpisodes.filter((k) => k !== key)
            : [...show.watchedEpisodes, key];
          // Record when the episode was marked watched (or forget it when unticked).
          const episodeWatchedAt = { ...show.episodeWatchedAt };
          if (has) delete episodeWatchedAt[key];
          else episodeWatchedAt[key] = now;
          // Un-ticking is a removal — mark it so the sync merge doesn't resurrect it.
          let tombstones = has
            ? addStamps(state.tombstones, 'episodes', [episodeTombstoneKey(item.id, key)], now)
            : state.tombstones;
          // Watching a new episode means the user resumed: clear any manual flag.
          const userStatus = has ? show.userStatus : undefined;
          // A resume that clears a manual status is a status clear — mark it so a
          // stale device's newer *unrelated* edit doesn't resurrect the old chip.
          if (show.userStatus && !userStatus) {
            tombstones = addStamps(tombstones, 'showStatus', [item.id], now);
          }
          // A show with no progress and no manual status is no longer tracked.
          if (watchedEpisodes.length === 0 && !userStatus) {
            const next = { ...state.trackedShows };
            delete next[item.id];
            // Only the per-episode tombstone (from the un-tick above) is recorded —
            // NOT a whole-show tombstone. On a stale/never-synced device this show
            // may be far larger in the cloud; a show tombstone would delete all of
            // it. The merge still drops the show once every episode is gone.
            return { trackedShows: next, tombstones };
          }
          // Once a show has any progress it is no longer merely "to watch"; tombstone
          // the implicit watchlist removal so it can't resurrect from another device.
          const wasListed =
            watchedEpisodes.length > 0 && state.watchlist.some((w) => isSame(w, 'tv', item.id));
          return {
            trackedShows: {
              ...state.trackedShows,
              [item.id]: {
                ...show,
                watchedEpisodes,
                episodeWatchedAt,
                lastUpdated: Date.now(),
                userStatus,
              },
            },
            tombstones: wasListed
              ? addStamps(tombstones, 'watchlist', [mediaKey('tv', item.id)])
              : tombstones,
            watchlist: wasListed
              ? state.watchlist.filter((w) => !isSame(w, 'tv', item.id))
              : state.watchlist,
          };
        }),

      setSeasonEpisodes: (item, totalEpisodes, seasonNumber, episodeNumbers, watched) =>
        set((state) => {
          // No episodes to change (e.g. "Mark all" on a not-yet-aired season) — a
          // strict no-op so it can't create/tombstone a synthetic empty show.
          if (episodeNumbers.length === 0) return state;
          const show = ensureTracked(state.trackedShows, item, totalEpisodes);
          const keys = episodeNumbers.map((n) => episodeKey(seasonNumber, n));
          const keySet = new Set(show.watchedEpisodes);
          const episodeWatchedAt = { ...show.episodeWatchedAt };
          const removed: string[] = [];
          const now = Date.now();
          keys.forEach((k) => {
            if (watched) {
              // Only stamp newly-added episodes so an existing watched date is kept.
              if (!keySet.has(k)) episodeWatchedAt[k] = now;
              keySet.add(k);
            } else {
              if (keySet.has(k)) removed.push(k);
              keySet.delete(k);
              delete episodeWatchedAt[k];
            }
          });
          const watchedEpisodes = [...keySet];
          let tombstones = addStamps(
            state.tombstones,
            'episodes',
            removed.map((k) => episodeTombstoneKey(item.id, k)),
            now,
          );
          const userStatus = watched ? undefined : show.userStatus;
          // Marking watched resumes the show → clears a manual status; mark the
          // clear so it isn't resurrected by a stale device's newer unrelated edit.
          if (show.userStatus && !userStatus) {
            tombstones = addStamps(tombstones, 'showStatus', [item.id], now);
          }
          if (watchedEpisodes.length === 0 && !userStatus) {
            const next = { ...state.trackedShows };
            delete next[item.id];
            // Per-episode tombstones only (see toggleEpisode) — no whole-show
            // tombstone, so a stale device can't wipe a larger cloud copy.
            return { trackedShows: next, tombstones };
          }
          const wasListed =
            watchedEpisodes.length > 0 && state.watchlist.some((w) => isSame(w, 'tv', item.id));
          return {
            trackedShows: {
              ...state.trackedShows,
              [item.id]: {
                ...show,
                watchedEpisodes,
                episodeWatchedAt,
                lastUpdated: Date.now(),
                userStatus,
              },
            },
            tombstones: wasListed
              ? addStamps(tombstones, 'watchlist', [mediaKey('tv', item.id)], now)
              : tombstones,
            watchlist: wasListed
              ? state.watchlist.filter((w) => !isSame(w, 'tv', item.id))
              : state.watchlist,
          };
        }),

      markEpisodesWatched: (item, totalEpisodes, keys) =>
        set((state) => {
          if (keys.length === 0) return state; // no-op guard (e.g. all-unaired bulk mark)
          const show = ensureTracked(state.trackedShows, item, totalEpisodes);
          const keySet = new Set(show.watchedEpisodes);
          const episodeWatchedAt = { ...show.episodeWatchedAt };
          const now = Date.now();
          keys.forEach((k) => {
            if (!keySet.has(k)) episodeWatchedAt[k] = now;
            keySet.add(k);
          });
          const watchedEpisodes = [...keySet];
          const wasListed =
            watchedEpisodes.length > 0 && state.watchlist.some((w) => isSame(w, 'tv', item.id));
          let tombstones = state.tombstones;
          // Marking watched clears any manual status — record the clear.
          if (show.userStatus) tombstones = addStamps(tombstones, 'showStatus', [item.id], now);
          if (wasListed) tombstones = addStamps(tombstones, 'watchlist', [mediaKey('tv', item.id)], now);
          return {
            trackedShows: {
              ...state.trackedShows,
              [item.id]: {
                ...show,
                watchedEpisodes,
                episodeWatchedAt,
                lastUpdated: now,
                userStatus: undefined,
              },
            },
            tombstones,
            watchlist: wasListed
              ? state.watchlist.filter((w) => !isSame(w, 'tv', item.id))
              : state.watchlist,
          };
        }),

      setShowStatus: (item, totalEpisodes, status) =>
        set((state) => {
          // Clearing status on a show that isn't tracked is a no-op — don't
          // synthesize a show just to "remove" it (which would write a phantom
          // tombstone that could delete a tracked copy on another device).
          if (status === null && !state.trackedShows[item.id]) return state;
          const base = ensureTracked(state.trackedShows, item, totalEpisodes);
          // Clearing status on a show with no episode progress removes it locally.
          // Record a `showStatus` tombstone (NOT a whole-show one) so the clear
          // sticks and propagates: a stale cloud copy would otherwise merge the
          // status-only show back in (and re-light the chip ~2.5s later), while a
          // whole-show tombstone would wrongly delete a far-larger cloud copy.
          if (status === null && base.watchedEpisodes.length === 0) {
            const next = { ...state.trackedShows };
            delete next[item.id];
            return {
              trackedShows: next,
              tombstones: addStamps(state.tombstones, 'showStatus', [item.id]),
            };
          }
          const now = Date.now();
          const wasListed = !!status && state.watchlist.some((w) => isSame(w, 'tv', item.id));
          let tombstones = state.tombstones;
          let revivals = state.revivals;
          if (status === null) {
            // Clearing status on a show that still has episodes: mark the clear
            // time so it beats an older set (revival) on merge, independent of the
            // show's `lastUpdated` (which unrelated episode edits bump).
            tombstones = addStamps(tombstones, 'showStatus', [item.id], now);
          } else {
            // Setting a status: mark the set time so it beats an older clear.
            revivals = addStamps(revivals, 'showStatus', [item.id], now);
            if (wasListed) {
              tombstones = addStamps(tombstones, 'watchlist', [mediaKey('tv', item.id)], now);
            }
          }
          return {
            trackedShows: {
              ...state.trackedShows,
              [item.id]: { ...base, userStatus: status ?? undefined, lastUpdated: now },
            },
            tombstones,
            revivals,
            // A categorized show is no longer merely "to watch".
            watchlist: wasListed
              ? state.watchlist.filter((w) => !isSame(w, 'tv', item.id))
              : state.watchlist,
          };
        }),

      setShowEpisodeRuntime: (id, runtime) =>
        set((state) => {
          const show = state.trackedShows[id];
          if (!show || show.episodeRuntime === runtime) return state;
          return {
            trackedShows: { ...state.trackedShows, [id]: { ...show, episodeRuntime: runtime } },
          };
        }),

      syncShowMeta: (id, meta) => get().syncShowsMeta([{ id, ...meta }]),

      syncShowsMeta: (updates) => {
        // Compared against the current state first, so a no-op never reaches `set`
        // (persist re-serializes the whole library on every `set`, even a no-op).
        const current = get().trackedShows;
        let shows: Record<number, TrackedShow> | null = null;
        for (const { id, totalEpisodes, airedEpisodes } of updates) {
          const show = (shows ?? current)[id];
          if (!show) continue;
          let next: TrackedShow | null = null;
          // totalEpisodes (episodes of seasons that have started airing — see
          // `statusEpisodeTotal`) drives status/grouping: a new season premiering
          // flips a completed show back to watching.
          if (totalEpisodes && totalEpisodes > 0 && show.totalEpisodes !== totalEpisodes) {
            next = { ...show, totalEpisodes };
          }
          // airedEpisodes (released so far) drives the progress denominator so
          // unaired future episodes aren't counted as "remaining".
          if (airedEpisodes && airedEpisodes > 0 && show.airedEpisodes !== airedEpisodes) {
            next = { ...(next ?? show), airedEpisodes };
          }
          if (!next) continue;
          shows ??= { ...current };
          shows[id] = next;
        }
        if (shows) set({ trackedShows: shows });
      },

      setItemCast: (mediaType, id, cast) =>
        set((state) => {
          if (mediaType === 'movie') {
            const movie = state.watchedMovies[id];
            if (!movie) return state;
            return { watchedMovies: { ...state.watchedMovies, [id]: { ...movie, cast } } };
          }
          const show = state.trackedShows[id];
          if (!show) return state;
          return { trackedShows: { ...state.trackedShows, [id]: { ...show, cast } } };
        }),

      setItemsCast: (updates) =>
        set((state) => {
          if (updates.length === 0) return state;
          let movies = state.watchedMovies;
          let shows = state.trackedShows;
          let moviesChanged = false;
          let showsChanged = false;
          for (const u of updates) {
            if (u.mediaType === 'movie') {
              const movie = movies[u.id];
              if (!movie) continue;
              if (!moviesChanged) {
                movies = { ...movies };
                moviesChanged = true;
              }
              movies[u.id] = { ...movie, cast: u.cast };
            } else {
              const show = shows[u.id];
              if (!show) continue;
              if (!showsChanged) {
                shows = { ...shows };
                showsChanged = true;
              }
              shows[u.id] = { ...show, cast: u.cast };
            }
          }
          if (!moviesChanged && !showsChanged) return state;
          return {
            ...(moviesChanged ? { watchedMovies: movies } : {}),
            ...(showsChanged ? { trackedShows: shows } : {}),
          };
        }),

      setSeasonCasts: (updates) =>
        set((state) => {
          if (updates.length === 0) return state;
          let shows = state.trackedShows;
          let changed = false;
          for (const u of updates) {
            const show = shows[u.showId];
            if (!show) continue;
            if (!changed) {
              shows = { ...shows };
              changed = true;
            }
            shows[u.showId] = {
              ...show,
              castBySeason: { ...show.castBySeason, [u.season]: u.cast },
            };
          }
          return changed ? { trackedShows: shows } : state;
        }),

      setCastRuleVersion: (version) => set({ castRuleVersion: version }),
    }),
    {
      name: 'library-store',
      storage: createJSONStorage(() => zustandStorage),
      version: 5,
      // Only persist data fields (actions are functions and never serialize
      // anyway); being explicit keeps future ephemeral state out of storage.
      partialize: (state) => ({
        watchlist: state.watchlist,
        watchedMovies: state.watchedMovies,
        trackedShows: state.trackedShows,
        tombstones: state.tombstones,
        revivals: state.revivals,
        onboarded: state.onboarded,
        theme: state.theme,
        ownerId: state.ownerId,
        castRuleVersion: state.castRuleVersion,
      }),
      // v2 narrowed ShowUserStatus; v3 also drops "dangling" shows that ended
      // up with no episode progress and no manual status; v4 adds `onboarded`
      // (existing users already have a library, so they skip onboarding); v5
      // fills in any missing tombstone/revival marker sub-keys (e.g. `showStatus`).
      migrate: (persisted) => {
        const state = (persisted ?? {}) as LibraryState;
        const shows = state?.trackedShows;
        if (shows && typeof shows === 'object') {
          for (const [id, show] of Object.entries(shows)) {
            // Guard against a corrupt/partial persisted show shape.
            if (!show || !Array.isArray(show.watchedEpisodes)) {
              delete shows[Number(id)];
              continue;
            }
            if (show.userStatus !== 'stopped' && show.userStatus !== 'continue_later') {
              delete show.userStatus;
            }
            if (show.watchedEpisodes.length === 0 && !show.userStatus) {
              delete shows[Number(id)];
            }
          }
        }
        // Merge over the empty shape so any missing sub-key (a marker category
        // added in a later version) is present, without dropping existing entries.
        state.tombstones =
          state.tombstones && typeof state.tombstones === 'object'
            ? { ...emptyTombstones(), ...state.tombstones }
            : emptyTombstones();
        state.revivals =
          state.revivals && typeof state.revivals === 'object'
            ? { ...emptyRevivals(), ...state.revivals }
            : emptyRevivals();
        // v3→v4 set this for pre-`onboarded` installs; only default it when it's
        // genuinely absent, so bumping the version doesn't re-onboard-skip a v4
        // user who is mid-onboarding (`onboarded: false`).
        if (typeof state.onboarded !== 'boolean') state.onboarded = true;
        return state;
      },
      // GC deletion/addition markers on every load too (not only during a sync's
      // merge) so a local-only / never-signed-in device doesn't accumulate them
      // forever in the persisted blob (which shares web's localStorage budget).
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const cutoff = Date.now() - MARKER_TTL_MS;
        const tombstones = pruneTombstones(state.tombstones, cutoff);
        const revivals = pruneRevivals(state.revivals, cutoff);
        // Only write when pruning actually removed something, so we don't force a
        // persist on every launch. Deferred to a microtask because with a
        // synchronous storage backend this callback runs *during* `create()` —
        // the `useLibraryStore` binding is still in its temporal dead zone, so a
        // direct `setState` here throws (silently swallowed → app never hydrates).
        // The setState is FUNCTIONAL (prunes the current state) so an edit made
        // between rehydration and the microtask can't be clobbered.
        if (stampCount(tombstones) !== stampCount(state.tombstones) || stampCount(revivals) !== stampCount(state.revivals)) {
          queueMicrotask(() =>
            useLibraryStore.setState((s) => {
              const c = Date.now() - MARKER_TTL_MS;
              return { tombstones: pruneTombstones(s.tombstones, c), revivals: pruneRevivals(s.revivals, c) };
            }),
          );
        }
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Pure derived helpers.
// ---------------------------------------------------------------------------

export function getShowStatus(show?: TrackedShow): ShowStatus {
  if (!show || show.watchedEpisodes.length === 0) return 'not_started';
  if (show.totalEpisodes > 0 && show.watchedEpisodes.length >= show.totalEpisodes) {
    return 'completed';
  }
  return 'watching';
}

export function getShowProgress(show?: TrackedShow): { watched: number; total: number } {
  // Progress is measured against episodes released so far (airedEpisodes), so
  // announced-but-unaired future episodes don't show up as "remaining".
  const total = show?.airedEpisodes ?? show?.totalEpisodes ?? 0;
  const watched = show?.watchedEpisodes.length ?? 0;
  // Some sources (e.g. TheTVDB imports) split episodes TMDB merges, so the raw
  // watched count can exceed the total. Clamp for display only.
  return { watched: total > 0 ? Math.min(watched, total) : watched, total };
}

/**
 * True once the persisted store has finished rehydrating from MMKV. Guards the
 * first-launch onboarding gate so it reads a real `onboarded` value.
 */
export function useStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useLibraryStore.persist.hasHydrated());
  useEffect(() => useLibraryStore.persist.onFinishHydration(() => setHydrated(true)), []);
  return hydrated;
}

// ---------------------------------------------------------------------------
// Stats.
// ---------------------------------------------------------------------------

export interface GenreCount {
  genre: string;
  count: number;
}

export interface MediaStats {
  /** Number of watched movies / tracked shows. */
  total: number;
  /** Total watched episodes (TV only). */
  episodes?: number;
  /** Total watch time in minutes (estimated for TV from typical episode length). */
  runtimeMinutes: number;
  /** Per-genre counts, sorted by count descending. */
  genres: GenreCount[];
}

function tallyGenres(items: { genres?: string[] }[]): GenreCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const genre of item.genres ?? []) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count);
}

export function getMovieStats(watchedMovies: Record<number, WatchedMovie>): MediaStats {
  const items = Object.values(watchedMovies);
  const runtimeMinutes = items.reduce((sum, m) => sum + (m.runtime ?? 0), 0);
  return { total: items.length, runtimeMinutes, genres: tallyGenres(items) };
}

export function getShowStats(trackedShows: Record<number, TrackedShow>): MediaStats {
  // Only shows with real episode progress count toward stats; the manual
  // user-status has no effect here.
  const items = Object.values(trackedShows).filter((s) => s.watchedEpisodes.length > 0);
  const episodes = items.reduce((sum, show) => sum + show.watchedEpisodes.length, 0);
  const runtimeMinutes = items.reduce(
    (sum, show) => sum + show.watchedEpisodes.length * (show.episodeRuntime ?? 0),
    0,
  );
  return { total: items.length, episodes, runtimeMinutes, genres: tallyGenres(items) };
}

/** Which part of the watched library the actor stat is scoped to. */
export type CastFilter = 'all' | 'movie' | 'tv';

export interface CastCount {
  id: number;
  name: string;
  /** Number of watched titles (in scope) the actor appears in. */
  count: number;
}

/** Cap on how many ranked actors the "Top actors & actresses" stat surfaces. */
export const TOP_CAST_LIMIT = 150;

/**
 * The cast to attribute a tracked show to in the actor stat: the de-duped union
 * of the top-billed cast of each season the user has watched ≥1 episode of (so an
 * actor who only appears in seasons you haven't watched isn't counted). Each
 * season is capped to {@link MAX_CAST}. Falls back to the series-level `cast` when
 * no per-season data has been fetched yet (older records / before the backfill),
 * so the stat degrades gracefully rather than emptying out.
 */
export function showCastForStat(show: TrackedShow): CastCredit[] {
  const bySeason = show.castBySeason;
  if (!bySeason) return (show.cast ?? []).slice(0, MAX_CAST);
  const watchedSeasons = new Set<number>();
  for (const key of show.watchedEpisodes) {
    const s = seasonFromEpisodeKey(key);
    if (s != null) watchedSeasons.add(s);
  }
  const seen = new Set<number>();
  const out: CastCredit[] = [];
  for (const season of watchedSeasons) {
    for (const c of (bySeason[season] ?? []).slice(0, MAX_CAST)) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
  }
  // Fall back to the series-level cast when no watched season has any stored
  // cast yet (e.g. only specials watched, or an import's season numbers 404 →
  // `[]`), so the show still contributes instead of silently vanishing.
  return out.length > 0 ? out : (show.cast ?? []).slice(0, MAX_CAST);
}

/**
 * Rank actors across the watched library by how many watched titles each appears
 * in. `filter` scopes to movies only, shows only, or both. Returns at most the
 * top {@link TOP_CAST_LIMIT} actors.
 */
export function getTopCast(
  watchedMovies: Record<number, WatchedMovie>,
  trackedShows: Record<number, TrackedShow>,
  filter: CastFilter,
): CastCount[] {
  const counts = new Map<number, CastCount>();
  const bump = (cast: CastCredit[]) => {
    for (const c of cast) {
      const existing = counts.get(c.id);
      if (existing) existing.count += 1;
      else counts.set(c.id, { id: c.id, name: c.name, count: 1 });
    }
  };
  if (filter !== 'tv') {
    // Movies: cap to the current top-billed limit (older records may hold more).
    for (const m of Object.values(watchedMovies)) bump((m.cast ?? []).slice(0, MAX_CAST));
  }
  if (filter !== 'movie') {
    // Shows: attribute only the cast of the seasons actually watched (already
    // per-season capped + de-duped by `showCastForStat`), still +1 per title.
    for (const s of Object.values(trackedShows)) {
      if (s.watchedEpisodes.length > 0) bump(showCastForStat(s));
    }
  }
  // Partial top-K selection instead of a full sort: rendering only the top
  // `TOP_CAST_LIMIT` doesn't justify sorting every actor (there can be thousands),
  // and `localeCompare` is the priciest comparator (it crosses into platform ICU
  // on Hermes). Bucket by count, take whole buckets from the highest count down
  // until we have enough, then sort just that subset. The within-equal-count
  // tiebreak is cosmetic, so a plain string compare is fine.
  const cmp = (a: CastCount, b: CastCount) =>
    b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const all = [...counts.values()];
  if (all.length <= TOP_CAST_LIMIT) return all.sort(cmp);
  const byCount = new Map<number, CastCount[]>();
  for (const c of all) {
    const bucket = byCount.get(c.count);
    if (bucket) bucket.push(c);
    else byCount.set(c.count, [c]);
  }
  const subset: CastCount[] = [];
  for (const count of [...byCount.keys()].sort((a, b) => b - a)) {
    subset.push(...byCount.get(count)!);
    if (subset.length >= TOP_CAST_LIMIT) break;
  }
  return subset.sort(cmp).slice(0, TOP_CAST_LIMIT);
}

/** Format a minutes total as "Xd Yh" / "Yh Zm" / "Zm". */
export function formatWatchTime(minutes: number): string {
  if (minutes <= 0) return '—';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ---------------------------------------------------------------------------
// Reactive selector hooks (subscribe to just the slice they need).
// ---------------------------------------------------------------------------

export const useIsInWatchlist = (mediaType: MediaItem['mediaType'], id: number) =>
  useLibraryStore((s) => s.watchlist.some((w) => isSame(w, mediaType, id)));

export const useIsMovieWatched = (id: number) =>
  useLibraryStore((s) => Boolean(s.watchedMovies[id]));

export const useTrackedShow = (id: number) => useLibraryStore((s) => s.trackedShows[id]);

export const useShowUserStatus = (id: number) =>
  useLibraryStore((s) => s.trackedShows[id]?.userStatus);

/** True when an item is already watched/tracked/categorized (so it shouldn't be "to watch"). */
export const useIsCategorized = (mediaType: MediaItem['mediaType'], id: number) =>
  useLibraryStore((s) => {
    if (mediaType === 'movie') return Boolean(s.watchedMovies[id]);
    const show = s.trackedShows[id];
    return Boolean(show && (show.userStatus || show.watchedEpisodes.length > 0));
  });
