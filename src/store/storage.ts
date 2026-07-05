import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

/**
 * Fast, synchronous on-device key-value storage.
 * This wrapper is the single place persistence is implemented, so swapping to
 * SQLite or a synced backend later is a localized change.
 */
export const storage = createMMKV({ id: 'moviesserieshub' });

/** Adapter that lets Zustand's `persist` middleware write to MMKV. */
export const zustandStorage: StateStorage = {
  setItem: (name, value) => {
    storage.set(name, value);
  },
  getItem: (name) => storage.getString(name) ?? null,
  removeItem: (name) => {
    storage.remove(name);
  },
};
