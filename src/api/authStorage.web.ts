import type { authStorage as NativeAuthStorage } from '@/api/authStorage';

/**
 * Web auth-session storage for Supabase.
 *
 * `react-native-mmkv` does not persist on web, so the Supabase session lives in
 * `localStorage` — this is what lets a signed-in session survive a page refresh.
 *
 * During static/server rendering there is no DOM, so `localStorage` access is
 * checked at call time and reports "no session" (null); the browser bundle reads
 * the real `localStorage` after hydration.
 *
 * Metro resolves this file for the `web` platform; native uses `authStorage.ts`.
 */
function ls(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export const authStorage: typeof NativeAuthStorage = {
  getItem: (key: string): string | null => {
    try {
      return ls()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      ls()?.setItem(key, value);
    } catch {
      /* no-op during server rendering */
    }
  },
  removeItem: (key: string): void => {
    try {
      ls()?.removeItem(key);
    } catch {
      /* no-op during server rendering */
    }
  },
};
