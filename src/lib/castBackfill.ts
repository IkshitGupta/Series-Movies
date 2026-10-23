import { create } from 'zustand';

import { getMovie, getSeasonCredits, hasApiKey, TmdbError } from '@/api/tmdb';
import { topCast } from '@/lib/normalize';
import { withRetry } from '@/lib/retry';
import { useLibraryStore } from '@/store/useLibraryStore';
import { seasonFromEpisodeKey, type CastCredit } from '@/types';

/**
 * Background backfill of the cast used by the "Top actors & actresses" stat:
 * - movies → the top-billed cast from the movie detail (stored on `cast`);
 * - shows → the top-billed cast of each *watched* season (stored on
 *   `castBySeason[season]`), so an actor is attributed only for seasons watched.
 *
 * A stored value (even `[]`, written when a title/season 404s) marks it fetched
 * so it isn't retried forever; a missing value is a candidate.
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

/** After an unhealthy run (almost always offline), automatic re-runs for that
 * account wait this long, so reopening a stats screen doesn't re-fire the same
 * doomed requests every time. Another account isn't held back. */
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;
let retryAfter: { owner: string | null; at: number } | null = null;

/** Selection-rule version the stored cast should be built with. Bump when the
 * cast-selection logic in `topCast` changes, to trigger a one-time re-fetch.
 * v3: re-run after fixing the merge that let a longer legacy cast revert the
 * hybrid re-selection, so devices sealed at v2 (possibly reverted) re-migrate. */
const CAST_RULE_VERSION = 3;

type Target =
  | { kind: 'movie'; id: number }
  | { kind: 'season'; showId: number; season: number };

function findTargets(migrating: boolean): Target[] {
  const s = useLibraryStore.getState();
  const targets: Target[] = [];
  for (const m of Object.values(s.watchedMovies)) {
    if (migrating || m.cast === undefined) targets.push({ kind: 'movie', id: m.id });
  }
  for (const show of Object.values(s.trackedShows)) {
    if (show.watchedEpisodes.length === 0) continue;
    const bySeason = show.castBySeason ?? {};
    const seen = new Set<number>();
    for (const key of show.watchedEpisodes) {
      const season = seasonFromEpisodeKey(key);
      if (season == null || seen.has(season)) continue;
      seen.add(season);
      if (migrating || bySeason[season] === undefined) {
        targets.push({ kind: 'season', showId: show.id, season });
      }
    }
  }
  return targets;
}

/** Fetch + store missing cast (movies + watched seasons) with bounded
 * concurrency. Safe to call repeatedly. When the selection rule changed
 * (`castRuleVersion` behind), it re-fetches every title once to re-select cast. */
export async function runCastBackfill(): Promise<void> {
  if (inFlight || !hasApiKey()) return;
  const owner = useLibraryStore.getState().ownerId;
  if (retryAfter && retryAfter.owner === owner && Date.now() < retryAfter.at) return;
  const migrating = (useLibraryStore.getState().castRuleVersion ?? 1) < CAST_RULE_VERSION;
  const targets = findTargets(migrating);
  // Empty library: leave the rule unsealed (nothing to migrate, no work) — it
  // seals on the first pass that actually has titles, so a not-yet-pulled account
  // isn't prematurely marked migrated.
  if (targets.length === 0) return;

  inFlight = true;
  useCastBackfillStatus.setState({ running: true, remaining: targets.length });
  const { setItemsCast, setSeasonCasts } = useLibraryStore.getState();

  // Buffer results and write them in chunks so a big backfill doesn't trigger a
  // store write (and full-library re-tally) per fetch. Stop early after a run of
  // failures — almost always offline — so we don't fire (and re-fire on every
  // Stats mount) hundreds of doomed requests; missing items are retried later.
  const movieBuf: { mediaType: 'movie'; id: number; cast: CastCredit[] }[] = [];
  const seasonBuf: { showId: number; season: number; cast: CastCredit[] }[] = [];
  let failures = 0;
  let errors = 0;
  let processed = 0;
  const FAILURE_CAP = 8;
  // Scale the flush batch with the run size so a huge migration writes the store
  // (and re-tallies/re-renders/persists the whole blob) ~8 times, not once per 25
  // items — the per-write cost is what causes visible hitches during a migration.
  const FLUSH_EVERY = Math.max(25, Math.ceil(targets.length / 8));
  const flush = () => {
    if (movieBuf.length > 0) setItemsCast(movieBuf.splice(0));
    if (seasonBuf.length > 0) setSeasonCasts(seasonBuf.splice(0));
  };

  let next = 0;
  const LIMIT = 4;
  const worker = async () => {
    while (next < targets.length) {
      // Stop only on a *run* of failures — almost always offline. A handful of
      // permanent 404s interspersed with successes won't halt the run.
      if (failures >= FAILURE_CAP) return;
      const t = targets[next++];
      try {
        if (t.kind === 'movie') {
          const detail = await withRetry(() => getMovie(t.id));
          const fresh = topCast(detail) ?? [];
          // Don't downgrade an existing good cast to `[]` when a re-scan gets an
          // empty/partial credits response — keep the prior non-empty value.
          const prev = useLibraryStore.getState().watchedMovies[t.id]?.cast;
          if (fresh.length > 0 || !prev?.length) {
            movieBuf.push({ mediaType: 'movie', id: t.id, cast: fresh });
          }
        } else {
          const credits = await withRetry(() => getSeasonCredits(t.showId, t.season));
          const fresh = topCast({ credits }) ?? [];
          const prev = useLibraryStore.getState().trackedShows[t.showId]?.castBySeason?.[t.season];
          if (fresh.length > 0 || !prev?.length) {
            seasonBuf.push({ showId: t.showId, season: t.season, cast: fresh });
          }
        }
        failures = 0; // reset the consecutive-failure counter on success
        processed += 1;
        if (movieBuf.length + seasonBuf.length >= FLUSH_EVERY) flush();
      } catch (e) {
        // A permanent "not found" won't succeed on retry — record empty so it
        // isn't re-fetched forever. But never wipe an existing good cast with `[]`
        // on a re-scan (a title/id TMDB later deletes would otherwise vanish).
        if (e instanceof TmdbError && e.status === 404) {
          if (t.kind === 'movie') {
            const prev = useLibraryStore.getState().watchedMovies[t.id]?.cast;
            if (!prev?.length) movieBuf.push({ mediaType: 'movie', id: t.id, cast: [] });
          } else {
            const prev = useLibraryStore.getState().trackedShows[t.showId]?.castBySeason?.[t.season];
            if (!prev?.length) seasonBuf.push({ showId: t.showId, season: t.season, cast: [] });
          }
          failures = 0;
          processed += 1;
        } else {
          failures += 1;
          errors += 1;
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
    // Seal the migration only for the account it was computed for (an account
    // switch mid-run must not seal the new account's library), once every target
    // was *dispatched* (`next >= length` — the run wasn't aborted offline by the
    // failure cap), at least one *resolved* (`processed > 0`), and total non-404
    // errors stayed within a small fraction of the run. The last guard matters
    // because the failure cap only bounds *consecutive* failures: an intermittent
    // network that sprinkles a success every few requests could otherwise dispatch
    // all targets, fail most, and permanently seal a mostly-unmigrated library.
    // Offline/aborted or mostly-failed runs retry later (after the cooldown); a
    // healthy run seals in one pass even with a few residual non-404 errors (those
    // keep their prior cast and heal via another device's `pickCast` "longer wins").
    const toleratedErrors = Math.max(1, Math.floor(targets.length * 0.05));
    const healthy = processed > 0 && next >= targets.length && errors <= toleratedErrors;
    if (migrating && useLibraryStore.getState().ownerId === owner && healthy) {
      useLibraryStore.getState().setCastRuleVersion(CAST_RULE_VERSION);
    }
    retryAfter = healthy ? null : { owner, at: Date.now() + RETRY_COOLDOWN_MS };
  }
}
