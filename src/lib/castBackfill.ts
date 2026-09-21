import { create } from 'zustand';

import { getMovie, getTv, hasApiKey, TmdbError } from '@/api/tmdb';
import { topCast } from '@/lib/normalize';
import { useLibraryStore } from '@/store/useLibraryStore';
import type { CastCredit } from '@/types';

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
  const setItemsCast = useLibraryStore.getState().setItemsCast;

  // Buffer results and write them in chunks so a big backfill doesn't trigger a
  // store write (and full-library re-tally) per title. Stop early after a run of
  // failures — almost always offline — so we don't fire (and re-fire on every
  // Stats mount) hundreds of doomed requests; the undefined items are retried on
  // a later run once connectivity is back.
  const buffer: { mediaType: 'movie' | 'tv'; id: number; cast: CastCredit[] }[] = [];
  let failures = 0;
  const FAILURE_CAP = 8;
  const FLUSH_EVERY = 25;
  const flush = () => {
    if (buffer.length > 0) setItemsCast(buffer.splice(0));
  };

  let next = 0;
  const LIMIT = 6;
  const worker = async () => {
    while (next < targets.length) {
      // Stop only on a *run* of failures — almost always offline — so we don't
      // fire (and re-fire on every Stats mount) hundreds of doomed requests. A
      // handful of permanent 404s interspersed with successes won't halt the run.
      if (failures >= FAILURE_CAP) return;
      const t = targets[next++];
      try {
        const detail = t.mediaType === 'movie' ? await getMovie(t.id) : await getTv(t.id);
        buffer.push({ mediaType: t.mediaType, id: t.id, cast: topCast(detail) ?? [] });
        failures = 0; // reset the consecutive-failure counter on success
        if (buffer.length >= FLUSH_EVERY) flush();
      } catch (e) {
        // A permanent "not found" won't succeed on retry — record empty cast so
        // it isn't re-fetched forever. Transient errors count toward the cap.
        if (e instanceof TmdbError && e.status === 404) {
          buffer.push({ mediaType: t.mediaType, id: t.id, cast: [] });
          failures = 0;
        } else {
          failures += 1;
        }
      } finally {
        useCastBackfillStatus.setState((s) => ({ remaining: Math.max(0, s.remaining - 1) }));
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(LIMIT, targets.length) }, worker));
  } finally {
    flush();
    inFlight = false;
    useCastBackfillStatus.setState({ running: false, remaining: 0 });
  }
}
