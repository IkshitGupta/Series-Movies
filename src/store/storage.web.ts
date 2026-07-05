import type { StateStorage } from 'zustand/middleware';

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

export const zustandStorage: StateStorage = {
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

export const storage = {
  set: (key: string, value: string) => zustandStorage.setItem(key, value),
  getString: (key: string) => zustandStorage.getItem(key) ?? undefined,
  remove: (key: string) => zustandStorage.removeItem(key),
};
