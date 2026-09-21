import type { StateStorage } from 'zustand/middleware';

import { createDebouncedStorage } from '@/store/persistDebounce';

/**
 * Web fallback for persistence. `react-native-mmkv` is native-only, so on web
 * (and during static server rendering) we use `localStorage`, falling back to
 * an in-memory map when no DOM storage is available (Node SSR).
 *
 * Metro resolves this file for the `web` platform; native platforms use
 * `storage.ts` (MMKV). The store only depends on `zustandStorage`.
 */
const memory = new Map<string, string>();
const hasLocalStorage = typeof localStorage !== 'undefined';

/** The disposable TMDB query cache (see `queryPersist.ts`). Evicted first when
 * `localStorage` is full so the irreplaceable user library always wins space. */
const QUERY_CACHE_KEY = 'tmdb-query-cache';

const baseAdapter: StateStorage = {
  setItem: (name, value) => {
    if (!hasLocalStorage) {
      memory.set(name, value);
      return;
    }
    try {
      localStorage.setItem(name, value);
    } catch (err) {
      // Usually a QuotaExceededError — the ~5MB origin budget filled up (often by
      // the TMDB query cache). Drop that disposable cache and retry once so the
      // user's library persists. If it STILL fails, rethrow so the debounced
      // storage layer re-queues and retries (rather than silently losing data).
      if (name === QUERY_CACHE_KEY) throw err; // evicting the cache to save the cache is pointless
      localStorage.removeItem(QUERY_CACHE_KEY);
      localStorage.setItem(name, value);
    }
  },
  getItem: (name) => {
    if (hasLocalStorage) return localStorage.getItem(name);
    return memory.get(name) ?? null;
  },
  removeItem: (name) => {
    if (hasLocalStorage) localStorage.removeItem(name);
    else memory.delete(name);
  },
};

const debounced = createDebouncedStorage(baseAdapter);

export const zustandStorage = debounced.storage;

/** Persist any pending coalesced write immediately (e.g. on app background). */
export const flushPendingWrites = debounced.flush;

/** No-op on web; MMKV-only file compaction lives in `storage.ts`. */
export function trimStorage(): void {
  // localStorage has no compaction step.
}

export const storage = {
  set: (key: string, value: string) => baseAdapter.setItem(key, value),
  getString: (key: string) => (baseAdapter.getItem(key) as string | null) ?? undefined,
  remove: (key: string) => baseAdapter.removeItem(key),
};
