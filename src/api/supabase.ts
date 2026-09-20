import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { authStorage } from '@/api/authStorage';

/**
 * Supabase client for accounts + cross-device library sync.
 *
 * The auth session is persisted per-platform via `authStorage` (MMKV on native,
 * `localStorage` on web — Metro resolves `authStorage.web.ts` for web). The
 * publishable (anon) key is safe to embed in the client — Row-Level Security on
 * the `libraries` table ensures each user can only read/write their own row.
 */
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
