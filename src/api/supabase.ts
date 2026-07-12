import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

/**
 * Supabase client for accounts + cross-device library sync.
 *
 * The auth session is persisted in a dedicated MMKV store (already a native
 * dependency, so no extra native module / rebuild is needed). The publishable
 * (anon) key is safe to embed in the client — Row-Level Security on the
 * `libraries` table ensures each user can only read/write their own row.
 */
// Created lazily and guarded so the client is import-safe during web
// static/server rendering, where there is no window and `react-native-mmkv`'s
// web shim throws when it reaches for `localStorage`.
let authMMKV: ReturnType<typeof createMMKV> | null = null;
try {
  authMMKV = createMMKV({ id: 'supabase-auth' });
} catch {
  authMMKV = null;
}

const authStorage = {
  getItem: (key: string): string | null => {
    // On the server there is no persisted session; returning null is correct
    // and avoids the "Tried to access storage on the server" crash.
    try {
      return authMMKV?.getString(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      authMMKV?.set(key, value);
    } catch {
      /* no-op during server rendering */
    }
  },
  removeItem: (key: string): void => {
    try {
      authMMKV?.remove(key);
    } catch {
      /* no-op during server rendering */
    }
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True when the Supabase env vars are configured (gates account/sync features). */
export function hasSupabase(): boolean {
  return Boolean(supabaseUrl && supabaseKey);
}

// Fall back to harmless placeholders when unconfigured so importing this module
// never throws at startup; `hasSupabase()` gates any real usage.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder-anon-key',
  {
    auth: {
      storage: authStorage,
      autoRefreshToken: true,
      persistSession: true,
      // No URL-based session detection on native (deep-link OAuth unused here).
      detectSessionInUrl: false,
    },
  },
);

// Keep the access token fresh only while the app is foregrounded (the
// recommended React Native pattern from the Supabase docs).
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
