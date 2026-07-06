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

const baseAdapter: StateStorage = {
  setItem: (name, value) => {
    if (hasLocalStorage) localStorage.setItem(name, value);
    else memory.set(name, value);
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
