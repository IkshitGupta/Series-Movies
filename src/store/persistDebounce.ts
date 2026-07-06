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

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const [name, value] of pending) base.setItem(name, value);
    pending.clear();
  };

  const storage: StateStorage = {
    setItem: (name, value) => {
      pending.set(name, value);
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
