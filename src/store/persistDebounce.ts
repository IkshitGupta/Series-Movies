import type { StateStorage } from 'zustand/middleware';

/**
 * Wraps a synchronous {@link StateStorage} so rapid successive writes to the
 * same key are coalesced into a single flush.
 *
 * Zustand's `persist` middleware calls `setItem` on every state change, and the
 * whole store is one blob under a single key — so bursts of mutations (e.g.
 * "mark all season", or several quick episode toggles) would otherwise each
 * append a full copy to MMKV's log, inflating the on-disk file. Coalescing the
 * writes keeps MMKV's append churn (and file growth) down.
 *
 * Reads return any not-yet-flushed value so persistence stays read-your-writes.
 */
export function createDebouncedStorage(
  base: StateStorage,
  delayMs = 500,
): { storage: StateStorage; flush: () => void } {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;
  const MAX_RETRIES = 5;

  const scheduleRetry = () => {
    if (retryTimer || pending.size === 0) return;
    // Give up after a bounded number of backed-off retries so a permanently
    // failing backend (e.g. `localStorage` over quota) can't hot-loop forever.
    // The latest state still lives in memory; the next mutation re-triggers.
    if (retryCount >= MAX_RETRIES) return;
    const backoff = Math.min(2000 * 2 ** retryCount, 60000);
    retryCount += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      flush();
    }, backoff);
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // Snapshot and clear before writing so a throwing backend can't leave stale
    // entries that re-throw on every future flush. Failed writes are re-queued
    // (unless a newer write already superseded the key) and retried with backoff.
    const entries = [...pending];
    pending.clear();
    for (const [name, value] of entries) {
      try {
        base.setItem(name, value);
      } catch {
        if (!pending.has(name)) pending.set(name, value);
      }
    }
    if (pending.size === 0) retryCount = 0; // clean flush → reset the backoff
    else scheduleRetry();
  };

  const storage: StateStorage = {
    setItem: (name, value) => {
      pending.set(name, value);
      retryCount = 0; // fresh data deserves a fresh set of retries
      // Cancel any armed backoff retry — the normal debounce timer below will
      // flush this (and whatever it re-queues), so the retry would be redundant.
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    getItem: (name) => {
      if (pending.has(name)) return pending.get(name) ?? null;
      return base.getItem(name);
    },
    removeItem: (name) => {
      pending.delete(name);
      base.removeItem(name);
    },
  };

  return { storage, flush };
}
