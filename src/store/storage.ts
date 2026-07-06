import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

import { createDebouncedStorage } from '@/store/persistDebounce';

/**
 * Fast, synchronous on-device key-value storage.
 * This wrapper is the single place persistence is implemented, so swapping to
 * SQLite or a synced backend later is a localized change.
 */
export const storage = createMMKV({ id: 'moviesserieshub' });

const mmkvAdapter: StateStorage = {
  setItem: (name, value) => {
    storage.set(name, value);
  },
  getItem: (name) => storage.getString(name) ?? null,
  removeItem: (name) => {
    storage.remove(name);
  },
};

const debounced = createDebouncedStorage(mmkvAdapter);

/** Adapter that lets Zustand's `persist` middleware write to MMKV (coalesced). */
export const zustandStorage = debounced.storage;

/** Persist any pending coalesced write immediately (e.g. on app background). */
export const flushPendingWrites = debounced.flush;

/**
 * Reclaim MMKV's file space. MMKV grows its memory-mapped file by doubling and
 * never shrinks it after deletions/overwrite churn, so a small library can sit
 * in a much larger file. Calling this compacts it back down.
 */
export function trimStorage(): void {
  storage.trim();
}
