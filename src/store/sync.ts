import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { hasSupabase, supabase } from '@/api/supabase';
import { mergeLibraries, type LibraryPayload } from '@/store/mergeLibraries';
import { flushPendingWrites } from '@/store/storage';
import { useAuth } from '@/store/useAuth';
import { useLibraryStore } from '@/store/useLibraryStore';

/**
 * Cross-device library sync.
 *
 * The library lives locally (MMKV/Zustand) and is mirrored to a single Supabase
 * row per user (`public.libraries`, `data jsonb`). Sync is **offline-first and
 * safe-merge**: watch marks (episodes/movies/watchlist) are unioned so none are
 * ever lost, while each show's *manual* status chip is resolved **newest-wins**
 * by `lastUpdated`, so a local status change/clear isn't reverted by the stale
 * cloud copy.
 *
 * A sync is a pull → merge → push:
 *   1. read the account's cloud row,
 *   2. merge it with the local library (see the merge section below),
 *   3. upload the merged result back.
 * The merge is order-independent, so running it on both devices converges.
 */

const TABLE = 'libraries';

// While we apply a pulled snapshot into the store, suppress the change-listener
// so the merge doesn't schedule another push (which would loop).
let applyingRemote = false;

/** The current local library, ready to upload. */
function currentPayload(): LibraryPayload {
  const s = useLibraryStore.getState();
  return {
    watchlist: s.watchlist,
    watchedMovies: s.watchedMovies,
    trackedShows: s.trackedShows,
  };
}

/** Coerce a jsonb blob from the server back into a well-formed payload. */
function normalizePayload(raw: unknown): LibraryPayload {
  const data = (raw ?? {}) as Partial<LibraryPayload>;
  return {
    watchlist: Array.isArray(data.watchlist) ? data.watchlist : [],
    watchedMovies: data.watchedMovies && typeof data.watchedMovies === 'object' ? data.watchedMovies : {},
    trackedShows: data.trackedShows && typeof data.trackedShows === 'object' ? data.trackedShows : {},
  };
}

// ---------------------------------------------------------------------------
// Apply a pulled snapshot.
// ---------------------------------------------------------------------------

/** Merge a pulled cloud snapshot into the local library and apply the result. */
function applyRemote(payload: LibraryPayload): void {
  applyingRemote = true;
  try {
    const merged = mergeLibraries(currentPayload(), payload);
    useLibraryStore.getState().replaceLibrary(merged);
  } finally {
    applyingRemote = false;
  }
}

/**
 * Make sure the local library is owned by the signed-in account before syncing.
 * - unowned (anonymous first login): adopt the local data into the account so it
 *   merges up (migration);
 * - already this account: nothing to do;
 * - a *different* account: start from empty so we never mix libraries — the other
 *   account's data is safe in its own cloud row and will be re-pulled if they
 *   sign back in.
 */
function ensureOwner(userId: string): void {
  const store = useLibraryStore.getState();
  if (store.ownerId === userId) return;
  if (store.ownerId != null && store.ownerId !== userId) {
    applyingRemote = true;
    try {
      store.replaceLibrary({ watchlist: [], watchedMovies: {}, trackedShows: {} });
    } finally {
      applyingRemote = false;
    }
  }
  store.setOwner(userId);
}

function errMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Something went wrong while syncing.';
}

// ---------------------------------------------------------------------------
// Sync status (surfaced in Settings).
// ---------------------------------------------------------------------------

export type SyncPhase = 'idle' | 'syncing' | 'error';

interface SyncStatusState {
  phase: SyncPhase;
  lastSyncedAt: number | null;
  error: string | null;
}

export const useSyncStatus = create<SyncStatusState>(() => ({
  phase: 'idle',
  lastSyncedAt: null,
  error: null,
}));

// ---------------------------------------------------------------------------
// The sync engine.
// ---------------------------------------------------------------------------

let running = false;
let rerun = false;

/**
 * Pull → merge → push the current account's library. Coalesces concurrent calls
 * (a request that arrives mid-sync triggers exactly one more run afterwards).
 */
export async function syncNow(): Promise<boolean> {
  if (!hasSupabase()) return false;
  if (running) {
    rerun = true;
    return false;
  }
  running = true;
  useSyncStatus.setState({ phase: 'syncing', error: null });
  let ok = false;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) {
      useSyncStatus.setState({ phase: 'idle' });
      return false;
    }
    ensureOwner(userId);

    // 1. Pull the cloud row and merge it into the local library.
    const { data: row, error: pullError } = await supabase
      .from(TABLE)
      .select('data')
      .eq('user_id', userId)
      .maybeSingle();
    if (pullError) throw pullError;
    if (row?.data) applyRemote(normalizePayload(row.data));

    // 2. Push the merged result back up.
    flushPendingWrites();
    const { error: pushError } = await supabase.from(TABLE).upsert(
      {
        user_id: userId,
        data: currentPayload() as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (pushError) throw pushError;

    useSyncStatus.setState({ phase: 'idle', lastSyncedAt: Date.now(), error: null });
    ok = true;
  } catch (e) {
    useSyncStatus.setState({ phase: 'error', error: errMessage(e) });
    ok = false;
  } finally {
    running = false;
  }
  if (rerun) {
    rerun = false;
    return syncNow();
  }
  return ok;
}

// Debounced push after local edits settle, so a burst of changes (e.g. "mark
// whole season") uploads once.
let pushTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncNow();
  }, 2500);
}

/**
 * Drives sync from the app root: reconciles ownership + pulls on sign-in, pushes
 * (debounced) after local edits, and re-syncs when the app returns to the
 * foreground. Mount once near the top of the tree.
 */
export function useSyncEngine(): void {
  const { session, loading } = useAuth();
  const userId = session?.user?.id ?? null;

  // Sign-in / account change → reconcile ownership and pull.
  useEffect(() => {
    if (loading || !hasSupabase() || !userId) return;
    void syncNow();
  }, [userId, loading]);

  // Local library edits → debounced push.
  useEffect(() => {
    if (!hasSupabase() || !userId) return;
    return useLibraryStore.subscribe((state, prev) => {
      if (applyingRemote) return;
      if (
        state.watchlist !== prev.watchlist ||
        state.watchedMovies !== prev.watchedMovies ||
        state.trackedShows !== prev.trackedShows
      ) {
        schedulePush();
      }
    });
  }, [userId]);

  // Returning to the foreground → pull any changes made on the other device.
  useEffect(() => {
    if (!hasSupabase() || !userId) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void syncNow();
    });
    return () => sub.remove();
  }, [userId]);
}
