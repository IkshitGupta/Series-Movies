import { create } from 'zustand';

import { getMovie, getTv, hasApiKey } from '@/api/tmdb';
import { topCast } from '@/lib/normalize';
import { useLibraryStore } from '@/store/useLibraryStore';

/**
 * One-time backfill of top cast for watched titles saved before cast was tracked
 * (or from imports). Cast only comes from a TMDB detail response, so titles added
 * before this feature have no cast — this fills them in the background so the
 * "Top actors & actresses" stat covers the whole existing library.
 *
 * `cast === undefined` means "never fetched" (a candidate); after a fetch we store
 * the cast (or `[]` when a title genuinely has none) so it isn't retried forever.
 */

interface BackfillStatus {
  running: boolean;
  remaining: number;
}

export const useCastBackfillStatus = create<BackfillStatus>(() => ({
  running: false,
  remaining: 0,
}));

let inFlight = false;

interface Target {
  mediaType: 'movie' | 'tv';
  id: number;
}

function findMissing(): Target[] {
  const s = useLibraryStore.getState();
  const targets: Target[] = [];
  for (const m of Object.values(s.watchedMovies)) {
    if (m.cast === undefined) targets.push({ mediaType: 'movie', id: m.id });
  }
  for (const show of Object.values(s.trackedShows)) {
    if (show.watchedEpisodes.length > 0 && show.cast === undefined) {
      targets.push({ mediaType: 'tv', id: show.id });
    }
  }
  return targets;
}

/** Fetch + store missing cast with bounded concurrency. Safe to call repeatedly. */
export async function runCastBackfill(): Promise<void> {
  if (inFlight || !hasApiKey()) return;
  const targets = findMissing();
  if (targets.length === 0) return;

  inFlight = true;
  useCastBackfillStatus.setState({ running: true, remaining: targets.length });
  const setItemCast = useLibraryStore.getState().setItemCast;

  let next = 0;
  const LIMIT = 6;
  const worker = async () => {
    while (next < targets.length) {
      const t = targets[next++];
      try {
        const detail = t.mediaType === 'movie' ? await getMovie(t.id) : await getTv(t.id);
        setItemCast(t.mediaType, t.id, topCast(detail) ?? []);
      } catch {
        // Network/lookup error: leave as-is so it's retried on a later run.
      } finally {
        useCastBackfillStatus.setState((s) => ({ remaining: Math.max(0, s.remaining - 1) }));
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(LIMIT, targets.length) }, worker));
  } finally {
    inFlight = false;
    useCastBackfillStatus.setState({ running: false, remaining: 0 });
  }
}
