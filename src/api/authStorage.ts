import { createMMKV } from 'react-native-mmkv';

/**
 * Native auth-session storage for Supabase.
 *
 * The session lives in a dedicated MMKV store (already a native dependency, so no
 * extra module / rebuild). Created lazily in a guard so importing this module is
 * safe even where MMKV can't initialize; every access is also guarded.
 *
 * Metro resolves `authStorage.web.ts` for the web platform instead (localStorage).
 */
let mmkv: ReturnType<typeof createMMKV> | null = null;
try {
  mmkv = createMMKV({ id: 'supabase-auth' });
} catch {
  mmkv = null;
}

export const authStorage = {
  getItem: (key: string): string | null => {
    try {
      return mmkv?.getString(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      mmkv?.set(key, value);
    } catch {
      /* no-op */
    }
  },
  removeItem: (key: string): void => {
    try {
      mmkv?.remove(key);
    } catch {
      /* no-op */
    }
  },
};
