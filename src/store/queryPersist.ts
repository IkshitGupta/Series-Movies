import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';

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

interface CacheEnvelope {
  v: number;
  savedAt: number;
  state: ReturnType<typeof dehydrate>;
}

function isPersistableKey(key: readonly unknown[]): boolean {
  return key[0] === 'movie' || key[0] === 'tv';
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
        query.state.status === 'success' && isPersistableKey(query.queryKey),
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
