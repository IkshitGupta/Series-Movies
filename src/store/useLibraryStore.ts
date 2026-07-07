import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { zustandStorage } from '@/store/storage';
import {
  episodeKey,
  type MediaItem,
  type ShowStatus,
  type ShowUserStatus,
  type ThemePref,
  type TrackedShow,
  type WatchedMovie,
  type WatchlistItem,
} from '@/types';

interface LibraryState {
  /** Single "To Watch" list (movies + shows mixed), newest first. */
  watchlist: WatchlistItem[];
  /** Watched movies keyed by TMDB movie id. */
  watchedMovies: Record<number, WatchedMovie>;
  /** Tracked shows (with per-episode progress) keyed by TMDB show id. */
  trackedShows: Record<number, TrackedShow>;
  /** Whether the one-time first-launch onboarding has been completed. */
  onboarded: boolean;
  /** Appearance preference (System / Light / Dark). */
  theme: ThemePref;

  // --- Appearance ---
  setTheme: (theme: ThemePref) => void;

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
  syncShowMeta: (id: number, meta: { totalEpisodes?: number; airedEpisodes?: number }) => void;
  untrackShow: (id: number) => void;
}

function isSame(item: WatchlistItem, mediaType: MediaItem['mediaType'], id: number): boolean {
  return item.mediaType === mediaType && item.id === id;
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
      // Backfill genres if the show was first tracked before genres were stored.
      genres: existing.genres ?? item.genres,
    };
  }
  return {
    ...item,
    mediaType: 'tv',
    watchedEpisodes: [],
    totalEpisodes,
    lastUpdated: Date.now(),
  };
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      watchlist: [],
      watchedMovies: {},
      trackedShows: {},
      onboarded: false,
      theme: 'system',

      setTheme: (theme) => set({ theme }),

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
          };
        }),

      addToWatchlist: (item) =>
        set((state) => {
          if (state.watchlist.some((w) => isSame(w, item.mediaType, item.id))) return state;
          return {
            watchlist: [{ ...item, addedAt: Date.now() }, ...state.watchlist],
          };
        }),

      removeFromWatchlist: (mediaType, id) =>
        set((state) => ({
          watchlist: state.watchlist.filter((w) => !isSame(w, mediaType, id)),
        })),

      markMovieWatched: (item) =>
        set((state) => ({
          watchedMovies: {
            ...state.watchedMovies,
            [item.id]: { ...item, mediaType: 'movie', watchedAt: Date.now() },
          },
          watchlist: state.watchlist.filter((w) => !isSame(w, 'movie', item.id)),
        })),

      unmarkMovieWatched: (id) =>
        set((state) => {
          const next = { ...state.watchedMovies };
          delete next[id];
          return { watchedMovies: next };
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
          const show = ensureTracked(state.trackedShows, item, totalEpisodes);
          const key = episodeKey(seasonNumber, episodeNumber);
          const has = show.watchedEpisodes.includes(key);
          const watchedEpisodes = has
            ? show.watchedEpisodes.filter((k) => k !== key)
            : [...show.watchedEpisodes, key];
          // Record when the episode was marked watched (or forget it when unticked).
          const episodeWatchedAt = { ...show.episodeWatchedAt };
          if (has) delete episodeWatchedAt[key];
          else episodeWatchedAt[key] = Date.now();
          // Watching a new episode means the user resumed: clear any manual flag.
          const userStatus = has ? show.userStatus : undefined;
          // A show with no progress and no manual status is no longer tracked.
          if (watchedEpisodes.length === 0 && !userStatus) {
            const next = { ...state.trackedShows };
            delete next[item.id];
            return { trackedShows: next };
          }
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
            // Once a show has any progress it is no longer merely "to watch".
            watchlist:
              watchedEpisodes.length > 0
                ? state.watchlist.filter((w) => !isSame(w, 'tv', item.id))
                : state.watchlist,
          };
        }),

      setSeasonEpisodes: (item, totalEpisodes, seasonNumber, episodeNumbers, watched) =>
        set((state) => {
          const show = ensureTracked(state.trackedShows, item, totalEpisodes);
          const keys = episodeNumbers.map((n) => episodeKey(seasonNumber, n));
          const keySet = new Set(show.watchedEpisodes);
          const episodeWatchedAt = { ...show.episodeWatchedAt };
          const now = Date.now();
          keys.forEach((k) => {
            if (watched) {
              // Only stamp newly-added episodes so an existing watched date is kept.
              if (!keySet.has(k)) episodeWatchedAt[k] = now;
              keySet.add(k);
            } else {
              keySet.delete(k);
              delete episodeWatchedAt[k];
            }
          });
          const watchedEpisodes = [...keySet];
          const userStatus = watched ? undefined : show.userStatus;
          if (watchedEpisodes.length === 0 && !userStatus) {
            const next = { ...state.trackedShows };
            delete next[item.id];
            return { trackedShows: next };
          }
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
            watchlist:
              watchedEpisodes.length > 0
                ? state.watchlist.filter((w) => !isSame(w, 'tv', item.id))
                : state.watchlist,
          };
        }),

      markEpisodesWatched: (item, totalEpisodes, keys) =>
        set((state) => {
          const show = ensureTracked(state.trackedShows, item, totalEpisodes);
          const keySet = new Set(show.watchedEpisodes);
          const episodeWatchedAt = { ...show.episodeWatchedAt };
          const now = Date.now();
          keys.forEach((k) => {
            if (!keySet.has(k)) episodeWatchedAt[k] = now;
            keySet.add(k);
          });
          const watchedEpisodes = [...keySet];
          return {
            trackedShows: {
              ...state.trackedShows,
              [item.id]: {
                ...show,
                watchedEpisodes,
                episodeWatchedAt,
                lastUpdated: Date.now(),
                userStatus: undefined,
              },
            },
            watchlist:
              watchedEpisodes.length > 0
                ? state.watchlist.filter((w) => !isSame(w, 'tv', item.id))
                : state.watchlist,
          };
        }),

      setShowStatus: (item, totalEpisodes, status) =>
        set((state) => {
          const base = ensureTracked(state.trackedShows, item, totalEpisodes);
          // Clearing status on a show with no episode progress removes it entirely.
          if (status === null && base.watchedEpisodes.length === 0) {
            const next = { ...state.trackedShows };
            delete next[item.id];
            return { trackedShows: next };
          }
          return {
            trackedShows: {
              ...state.trackedShows,
              [item.id]: { ...base, userStatus: status ?? undefined, lastUpdated: Date.now() },
            },
            // A categorized show is no longer merely "to watch".
            watchlist: status
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

      syncShowMeta: (id, meta) =>
        set((state) => {
          const show = state.trackedShows[id];
          if (!show) return state;
          const next = { ...show };
          let changed = false;
          // totalEpisodes (incl. announced) drives status/grouping; a new season
          // aired/announced flips a completed show back to watching.
          if (
            meta.totalEpisodes &&
            meta.totalEpisodes > 0 &&
            show.totalEpisodes !== meta.totalEpisodes
          ) {
            next.totalEpisodes = meta.totalEpisodes;
            changed = true;
          }
          // airedEpisodes (released so far) drives the progress denominator so
          // unaired future episodes aren't counted as "remaining".
          if (
            meta.airedEpisodes &&
            meta.airedEpisodes > 0 &&
            show.airedEpisodes !== meta.airedEpisodes
          ) {
            next.airedEpisodes = meta.airedEpisodes;
            changed = true;
          }
          if (!changed) return state;
          return { trackedShows: { ...state.trackedShows, [id]: next } };
        }),

      untrackShow: (id) =>
        set((state) => {
          const next = { ...state.trackedShows };
          delete next[id];
          return { trackedShows: next };
        }),
    }),
    {
      name: 'library-store',
      storage: createJSONStorage(() => zustandStorage),
      version: 4,
      // Only persist data fields (actions are functions and never serialize
      // anyway); being explicit keeps future ephemeral state out of storage.
      partialize: (state) => ({
        watchlist: state.watchlist,
        watchedMovies: state.watchedMovies,
        trackedShows: state.trackedShows,
        onboarded: state.onboarded,
        theme: state.theme,
      }),
      // v2 narrowed ShowUserStatus; v3 also drops "dangling" shows that ended
      // up with no episode progress and no manual status; v4 adds `onboarded`
      // (existing users already have a library, so they skip onboarding).
      migrate: (persisted) => {
        const state = persisted as LibraryState;
        const shows = state?.trackedShows;
        if (shows) {
          for (const [id, show] of Object.entries(shows)) {
            if (show.userStatus !== 'stopped' && show.userStatus !== 'continue_later') {
              delete show.userStatus;
            }
            if (show.watchedEpisodes.length === 0 && !show.userStatus) {
              delete shows[Number(id)];
            }
          }
        }
        state.onboarded = true;
        return state;
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
