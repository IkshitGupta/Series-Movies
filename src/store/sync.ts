import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { hasSupabase, supabase } from '@/api/supabase';
import { mergeLibraries, type LibraryPayload } from '@/store/mergeLibraries';
import { flushPendingWrites } from '@/store/storage';
import { useAuth } from '@/store/useAuth';
import { useLibraryStore } from '@/store/useLibraryStore';
import { emptyRevivals, emptyTombstones } from '@/types';

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
    tombstones: s.tombstones,
    revivals: s.revivals,
  };
}

/** Drop any remote show entry with a corrupt shape so derived selectors (which
 * read `watchedEpisodes.length`) never crash on a malformed cloud blob. */
function sanitizeShows(raw: unknown): LibraryPayload['trackedShows'] {
  if (!raw || typeof raw !== 'object') return {};
  const out: LibraryPayload['trackedShows'] = {};
  for (const [id, show] of Object.entries(raw as Record<string, unknown>)) {
    const s = show as { watchedEpisodes?: unknown };
    if (s && Array.isArray(s.watchedEpisodes)) {
      out[Number(id)] = show as LibraryPayload['trackedShows'][number];
    }
  }
  return out;
}

/** Coerce a jsonb blob from the server back into a well-formed payload. */
function normalizePayload(raw: unknown): LibraryPayload {
  const data = (raw ?? {}) as Partial<LibraryPayload>;
  const t = data.tombstones;
  const r = data.revivals;
  return {
    watchlist: Array.isArray(data.watchlist) ? data.watchlist : [],
    watchedMovies: data.watchedMovies && typeof data.watchedMovies === 'object' ? data.watchedMovies : {},
    trackedShows: sanitizeShows(data.trackedShows),
    tombstones:
      t && typeof t === 'object'
        ? {
            movies: t.movies ?? {},
            shows: t.shows ?? {},
            showStatus: t.showStatus ?? {},
            watchlist: t.watchlist ?? {},
            episodes: t.episodes ?? {},
          }
        : undefined,
    revivals:
      r && typeof r === 'object'
        ? { movies: r.movies ?? {}, episodes: r.episodes ?? {}, showStatus: r.showStatus ?? {} }
        : undefined,
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
    const store = useLibraryStore.getState();
    store.replaceLibrary(merged);
    // A returning account that already has synced data shouldn't be shown the
    // first-run onboarding ("import / start fresh") — mark it onboarded so the
    // gate lets it straight through to its library.
    const hasData =
      merged.watchlist.length > 0 ||
      Object.keys(merged.watchedMovies).length > 0 ||
      Object.keys(merged.trackedShows).length > 0;
    if (hasData && !store.onboarded) store.setOnboarded(true);
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
// Bumped whenever the signed-in account this device's library belongs to
// changes. An in-flight sync captures the value and bails if it changes under it
// (so a sync for account A that's mid-flight when B signs in can't merge/push
// A's data into B's store or cloud row).
let authGen = 0;

function ensureOwner(userId: string): void {
  const store = useLibraryStore.getState();
  if (store.ownerId === userId) return;
  authGen += 1;
  if (store.ownerId != null && store.ownerId !== userId) {
    applyingRemote = true;
    try {
      store.replaceLibrary({
        watchlist: [],
        watchedMovies: {},
        trackedShows: {},
        tombstones: emptyTombstones(),
        revivals: emptyRevivals(),
      });
    } finally {
      applyingRemote = false;
    }
    // This is a different account: reset the onboarding gate so it waits for
    // *this* account's first pull (rather than waving it straight through on the
    // previous account's `onboarded=true`). `applyRemote` re-sets onboarded to
    // true as soon as a non-empty library is pulled.
    store.setOnboarded(false);
    // The pulled account's cast was selected under its own devices' rule version,
    // so force a re-selection pass for this account's library on this device.
    store.setCastRuleVersion(1);
    useSyncStatus.setState({ lastSyncedAt: null, phase: 'idle', error: null });
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
/** Resolvers for `syncNow` calls that coalesced into the in-flight run; resolved
 * with the authoritative final result so callers (e.g. sign-out) can trust it. */
const waiters: ((ok: boolean) => void)[] = [];
/** Syncs in a row that failed because the cloud couldn't be reached (offline,
 * server down). Such a failure is retried with growing pauses: 5 s, 10 s, 20 s,
 * then 30 s between attempts. Native has no "back online" event without a native
 * module, so this retry is what uploads changes made offline once the connection
 * returns. */
let failureStreak = 0;

/** Max compare-and-swap attempts before giving up (and retrying later) rather
 * than blindly overwriting a concurrent write. */
const MAX_CAS_ATTEMPTS = 4;

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === '23505';
}

/**
 * A failure that may clear up by itself: no response at all (offline, DNS, a
 * dropped connection — postgrest-js reports status 0), a timeout, rate limit or
 * server error, or a token refresh that couldn't reach the server. A request the
 * server rejected, or a bug, would fail the same way again. `pullMergePush`
 * throws PostgREST errors with the response's `status` attached.
 */
function isTransient(e: unknown): boolean {
  if (isAuthRetryableFetchError(e)) return true;
  const status = (e as { status?: unknown } | null)?.status;
  return (
    typeof status === 'number' &&
    (status === 0 || status === 408 || status === 429 || status >= 500)
  );
}

/**
 * One pull → merge → push cycle with an optimistic-concurrency push. Returns
 * `'ok'` when the merged result was persisted, or `'conflict'` when another
 * device wrote in between (so the caller should re-pull + re-merge + retry).
 * Throws on a real error.
 */
async function pullMergePush(userId: string, gen: number): Promise<'ok' | 'conflict' | 'stale'> {
  const {
    data: row,
    error: pullError,
    status: pullStatus,
  } = await supabase.from(TABLE).select('data, updated_at').eq('user_id', userId).maybeSingle();
  if (pullError) throw Object.assign(pullError, { status: pullStatus });
  // The account changed under us (another sign-in ran `ensureOwner`) — abort
  // before merging this account's cloud data into the new account's store.
  if (authGen !== gen || useLibraryStore.getState().ownerId !== userId) return 'stale';
  if (row?.data) applyRemote(normalizePayload(row.data));

  flushPendingWrites();
  const data = currentPayload() as unknown as Record<string, unknown>;
  // Ensure the new CAS token is STRICTLY greater than the pulled one. If this
  // push lands in the same millisecond the row was last written, a plain
  // `Date.now()` could equal `row.updated_at`, leaving the token unchanged — so a
  // concurrent device CAS-ing on that same token would also "succeed" and clobber
  // this write. Advancing past it keeps the optimistic-concurrency check sound.
  const pulledMs = row?.updated_at ? Date.parse(row.updated_at) : 0;
  const stamp = new Date(Math.max(Date.now(), pulledMs + 1)).toISOString();

  if (!row) {
    // First write for this account: INSERT only. If another device inserted
    // first, we get a unique-violation and retry (pulling + merging its data)
    // instead of blindly overwriting it.
    const { error, status } = await supabase
      .from(TABLE)
      .insert({ user_id: userId, data, updated_at: stamp });
    if (!error) return 'ok';
    if (isUniqueViolation(error)) return 'conflict';
    throw Object.assign(error, { status });
  }

  // Compare-and-swap on the pulled `updated_at` token (legacy rows may have a
  // null token — match on null once to establish one).
  let q = supabase.from(TABLE).update({ data, updated_at: stamp }).eq('user_id', userId);
  q = row.updated_at == null ? q.is('updated_at', null) : q.eq('updated_at', row.updated_at);
  const { data: updated, error: pushError, status: pushStatus } = await q.select('user_id');
  if (pushError) throw Object.assign(pushError, { status: pushStatus });
  return updated && updated.length > 0 ? 'ok' : 'conflict';
}

/**
 * Pull → merge → push the current account's library. Coalesces concurrent calls:
 * a request that arrives mid-sync triggers exactly one more run afterwards, and
 * its promise resolves with that follow-up run's result (so callers like sign-out
 * see the true outcome, not a premature `false`).
 */
export async function syncNow(): Promise<boolean> {
  if (!hasSupabase()) return false;
  if (running) {
    rerun = true;
    return new Promise<boolean>((resolve) => waiters.push(resolve));
  }
  running = true;
  // This run pushes the current library, so a pending debounced push or retry
  // would only repeat it.
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  useSyncStatus.setState({ phase: 'syncing', error: null });
  let ok = false;
  let exhausted = false;
  let retry = false;
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    // An expired access token that can't be refreshed (e.g. offline) comes back
    // as no session plus an error: a failed sync to retry, not a sign-out.
    if (!userId && sessionError) throw sessionError;
    if (!userId) {
      failureStreak = 0;
      useSyncStatus.setState({ phase: 'idle' });
      // fall through (don't early-return) so `rerun`/waiters are still handled.
    } else {
      ensureOwner(userId);
      const gen = authGen;

      // Bounded compare-and-swap loop (a single monotonic counter, so a coalesced
      // rerun can't reset the budget). Each attempt re-pulls + re-merges.
      let result: 'ok' | 'conflict' | 'stale' = 'conflict';
      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
        result = await pullMergePush(userId, gen);
        if (result === 'ok' || result === 'stale') break;
      }
      if (result === 'ok') {
        exhaustionStreak = 0;
        failureStreak = 0;
        useSyncStatus.setState({ phase: 'idle', lastSyncedAt: Date.now(), error: null });
        ok = true;
      } else if (result === 'stale') {
        // Account switched mid-sync — the follow-up run (rerun) handles the new
        // account. Do nothing here.
        exhaustionStreak = 0;
        failureStreak = 0;
        useSyncStatus.setState({ phase: 'idle', error: null });
      } else {
        // Persistent contention. Never blind-overwrite (that risks dropping the
        // other device's write); the local edits are already merged with the
        // latest pull and stay pending — retry with backoff. If it never resolves
        // (e.g. an RLS policy blocks UPDATE), surface an error instead of hot-looping.
        exhausted = true;
        exhaustionStreak += 1;
        failureStreak = 0;
        if (exhaustionStreak >= 3) {
          useSyncStatus.setState({ phase: 'error', error: 'Couldn’t save changes to the cloud. Retrying…' });
        } else {
          useSyncStatus.setState({ phase: 'idle', error: null });
        }
      }
    }
  } catch (e) {
    exhaustionStreak = 0;
    // Only a failure that may clear up by itself is retried on a timer; a rejected
    // request waits for the next edit, foreground, reconnect or manual retry.
    retry = isTransient(e);
    failureStreak = retry ? failureStreak + 1 : 0;
    useSyncStatus.setState({ phase: 'error', error: errMessage(e) });
    ok = false;
  } finally {
    running = false;
  }
  // Resolve callers that coalesced into this run with the authoritative result,
  // in a finally so they can never be abandoned (a hung sign-out) even if the
  // rerun path below throws. Backoff is applied BEFORE the rerun so persistent
  // contention can't skip it (an edit-triggered rerun would otherwise hot-loop).
  let finalOk = ok;
  try {
    if (exhausted) {
      // A pending rerun is absorbed into the scheduled (backed-off) retry.
      rerun = false;
      schedulePush(Math.min(2500 * 2 ** (exhaustionStreak - 1), 120000));
    } else if (rerun) {
      rerun = false;
      finalOk = await syncNow().catch(() => false); // the recursive call drains the shared waiters
    } else if (retry && !pushTimer) {
      // An edit made during this run has already scheduled a sooner push.
      schedulePush(Math.min(5000 * 2 ** (failureStreak - 1), 30000));
    }
  } finally {
    const queued = waiters.splice(0);
    for (const resolve of queued) resolve(finalOk);
  }
  return finalOk;
}

// Debounced push after local edits settle, so a burst of changes (e.g. "mark
// whole season") uploads once.
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let exhaustionStreak = 0;
function schedulePush(delayMs = 2500): void {
  // While in an exhaustion backoff, a normal edit must NOT shorten the backoff
  // back to 2.5s (that would hammer a permanently-failing UPDATE every 2.5s). The
  // edit's data is picked up when the already-armed backoff fires.
  if (pushTimer && exhaustionStreak > 0 && delayMs <= 2500) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncNow();
  }, delayMs);
}

/**
 * Drives sync from the app root: reconciles ownership + pulls on sign-in, pushes
 * (debounced) after local edits, re-syncs when the app returns to the foreground
 * and, on the web, as soon as the browser is back online. A failed sync retries
 * itself (see `failureStreak`). Mount once near the top of the tree.
 */
export function useSyncEngine(): void {
  const { session, loading } = useAuth();
  const userId = session?.user?.id ?? null;

  // Sign-in / account change → reconcile ownership, then pull. Reconcile eagerly
  // only when no sync is in flight, so the owner-gate clears fast on a normal
  // switch; if a sync IS running (for the previous account), let it finish and
  // push first — `syncNow`'s own `ensureOwner` + `rerun` then does the switch, so
  // the previous account's in-flight edits aren't wiped before they're saved.
  useEffect(() => {
    if (loading || !hasSupabase() || !userId) return;
    if (!running) ensureOwner(userId);
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
        state.trackedShows !== prev.trackedShows ||
        state.tombstones !== prev.tombstones ||
        state.revivals !== prev.revivals
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

  // Web: the browser reports when the connection is back, so sync right away
  // instead of waiting for the next retry. The backoff starts over, because the
  // first tries after reconnecting often fail while the network settles.
  useEffect(() => {
    if (Platform.OS !== 'web' || !hasSupabase() || !userId) return;
    const onOnline = () => {
      failureStreak = 0;
      void syncNow();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [userId]);
}
