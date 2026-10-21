import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';

import { storage } from '@/store/storage';

/**
 * Cross-restart persistence for the TMDB React Query cache.
 *
 * The app is offline-first, but the query cache is otherwise memory-only — every
 * cold start would re-fetch movie/show/season detail. We dehydrate the cache to
 * MMKV (reusing the app's existing storage) so previously-opened detail loads
 * instantly and works offline, cutting redundant TMDB calls.
 *
 * Only successful `movie`/`tv` (incl. season) queries are persisted; volatile
 * `search` results are intentionally excluded so search stays fresh. A version
 * tag and max-age guard the restore so schema changes or stale blobs are dropped.
 */
const CACHE_KEY = 'tmdb-query-cache';
const CACHE_VERSION = 1;
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const WRITE_DEBOUNCE_MS = 1000;
/** Queries kept only briefly — e.g. show details a background refresh fetched
 * without any screen showing them — are never persisted. Dehydration drops
 * `gcTime`, so a restored copy would come back with the default 24h lifetime and
 * linger across launches. (A query a screen has observed carries the longer
 * default, since TanStack keeps the max `gcTime` across observers.) */
const MIN_PERSIST_GC_MS = 1000 * 60 * 5;

interface CacheEnvelope {
  v: number;
  savedAt: number;
  state: ReturnType<typeof dehydrate>;
}

function isPersistableKey(key: readonly unknown[]): boolean {
  if (key[0] !== 'movie' && key[0] !== 'tv') return false;
  // On web the whole query cache shares the ~5MB `localStorage` origin budget
  // with the user library. Season payloads (full episode lists + stills) are by
  // far the largest, so skip them on web to keep the library safely under quota;
  // they're cheap to refetch and native (MMKV) has no such limit.
  if (Platform.OS === 'web' && key[2] === 'season') return false;
  return true;
}

/** Restore the persisted cache into `client`. Safe to call once at startup. */
export function hydrateQueryCache(client: QueryClient): void {
  const raw = storage.getString(CACHE_KEY);
  if (!raw) return;
  try {
    const env = JSON.parse(raw) as CacheEnvelope;
    if (env.v !== CACHE_VERSION || Date.now() - env.savedAt > MAX_AGE_MS) {
      storage.remove(CACHE_KEY);
      return;
    }
    hydrate(client, env.state);
  } catch {
    // Corrupt/unreadable cache — drop it and start clean.
    storage.remove(CACHE_KEY);
  }
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingClient: QueryClient | null = null;

function write(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const client = pendingClient;
  pendingClient = null;
  if (!client) return;
  try {
    const state = dehydrate(client, {
      shouldDehydrateQuery: (query) =>
        query.state.status === 'success' &&
        query.gcTime >= MIN_PERSIST_GC_MS &&
        isPersistableKey(query.queryKey),
    });
    const env: CacheEnvelope = { v: CACHE_VERSION, savedAt: Date.now(), state };
    storage.set(CACHE_KEY, JSON.stringify(env));
  } catch {
    // Persistence is best-effort; never let it crash the app.
  }
}

/** Persist any pending cache write immediately (e.g. on app background). */
export function flushQueryCache(): void {
  if (pendingClient) write();
}

/**
 * Subscribe to cache changes and persist them (coalesced). Returns an
 * unsubscribe function.
 */
export function startQueryCachePersistence(client: QueryClient): () => void {
  return client.getQueryCache().subscribe(() => {
    pendingClient = client;
    if (!writeTimer) writeTimer = setTimeout(write, WRITE_DEBOUNCE_MS);
  });
}
