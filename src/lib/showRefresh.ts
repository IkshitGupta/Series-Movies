import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { queryKeys } from '@/api/queries';
import { getTv, hasApiKey, TmdbError } from '@/api/tmdb';
import { airedEpisodeCount, statusEpisodeTotal } from '@/lib/airing';
import { storage, zustandStorage } from '@/store/storage';
import { useLibraryStore } from '@/store/useLibraryStore';
import type { TmdbTvDetails, TrackedShow } from '@/types';

/**
 * Background refresh of tracked shows' episode totals, so the Series tab's
 * Watching/Completed grouping follows TMDB without opening each show: a finished
 * show moves back to Watching when its new season premieres, and a caught-up show
 * stays in Watching while TMDB adds the next episodes of its airing season. It
 * also records each show's next air date for the Completed tab's Upcoming filter.
 *
 * Throttled per show by a small device-local ledger (never synced): airing shows
 * are re-checked every ~12h, ended/cancelled ones only every month or so
 * (revivals, TMDB fixes; staggered so they don't all fall due together). A show
 * whose stored total no longer matches the one last derived here (a sync merged
 * in another device's older value) is re-checked right away instead.
 */

const LEDGER_KEY = 'show-refresh-ledger';
const LEDGER_VERSION = 1;
const AIRING_RECHECK_MS = 1000 * 60 * 60 * 12;
const ENDED_RECHECK_MS = 1000 * 60 * 60 * 24 * 30;
const CONCURRENCY = 4;
/** Stop after this many consecutive failures — almost always offline. */
const FAILURE_CAP = 6;
const FLUSH_EVERY = 10;
/** Reuse a show detail fetched within this window instead of refetching it. */
const REUSE_MS = 1000 * 60 * 60;
/** Details fetched only for this refresh are dropped soon after (unless a screen
 * is showing them) and never persisted (`queryPersist` skips short-lived
 * queries), so the TMDB cache doesn't balloon. */
const TRANSIENT_GC_MS = 1000 * 60;

/** Per show: [last checked (epoch ms), 1 if ended/cancelled with nothing scheduled,
 * the status total derived then]. */
type LedgerEntry = [checkedAt: number, ended: 0 | 1, total?: number];

interface Ledger {
  v: number;
  /** Account the entries belong to; a different account starts fresh. */
  owner: string | null;
  shows: Record<string, LedgerEntry>;
}

function loadLedger(owner: string | null): Ledger {
  try {
    const raw = storage.getString(LEDGER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Ledger;
      if (parsed?.v === LEDGER_VERSION && parsed.owner === owner && parsed.shows) return parsed;
    }
  } catch {
    // Corrupt ledger — start fresh (it's only a throttle).
  }
  return { v: LEDGER_VERSION, owner, shows: {} };
}

interface ScheduleState {
  /** Next scheduled air date (`YYYY-MM-DD`) per tracked show from its latest TMDB
   * detail, or null when nothing is scheduled. Device-local (never synced). */
  next: Record<number, string | null>;
  /** True while a background refresh is checking shows. */
  checking: boolean;
}

/** Each show's next scheduled air date — kept current by the refresh, visible
 * Series rows, and the show page — so the Completed tab can filter the shows
 * with something coming without fetching every show. */
export const useShowSchedule = create<ScheduleState>()(
  persist((): ScheduleState => ({ next: {}, checking: false }), {
    name: 'show-schedule',
    storage: createJSONStorage(() => zustandStorage),
    version: 1,
    partialize: (s) => ({ next: s.next }),
  }),
);

function setNextDates(entries: [id: number, date: string | null][]): void {
  const current = useShowSchedule.getState().next;
  let next: Record<number, string | null> | null = null;
  for (const [id, date] of entries) {
    if (current[id] === date) continue;
    next ??= { ...current };
    next[id] = date;
  }
  if (next) useShowSchedule.setState({ next });
}

/** Record a tracked show's next scheduled air date from a fetched TMDB detail. */
export function noteNextAirDate(id: number, tv: Pick<TmdbTvDetails, 'next_episode_to_air'>): void {
  setNextDates([[id, tv.next_episode_to_air?.air_date ?? null]]);
}

/** The stored total no longer matches what we last derived from TMDB — e.g. a sync
 * merged in another device's older value — so it should be re-derived now. */
function diverged(show: TrackedShow, entry: LedgerEntry | undefined): boolean {
  return !!entry?.[2] && show.totalEpisodes !== entry[2];
}

function isDue(show: TrackedShow, entry: LedgerEntry | undefined, now: number): boolean {
  if (!entry || diverged(show, entry)) return true;
  // Ended shows are staggered by id (+0–90%) so a big library's re-checks spread out.
  const interval = entry[1] ? ENDED_RECHECK_MS * (1 + (show.id % 10) / 10) : AIRING_RECHECK_MS;
  return now - entry[0] >= interval;
}

let inFlight = false;
let rerun = false;

/** Refresh the totals of tracked shows that are due (or whose stored total
 * diverged from TMDB). Safe to call often — on Series focus and on every library
 * change: it's cheap when nothing is due, and a call made mid-run triggers one
 * more pass afterwards so a change that lands during a run isn't missed. */
export async function refreshShowTotals(queryClient: QueryClient): Promise<void> {
  if (!hasApiKey()) return;
  if (inFlight) {
    rerun = true;
    return;
  }
  inFlight = true;
  try {
    do {
      rerun = false;
      await refreshOnce(queryClient);
    } while (rerun);
  } finally {
    inFlight = false;
    if (useShowSchedule.getState().checking) useShowSchedule.setState({ checking: false });
  }
}

async function refreshOnce(queryClient: QueryClient): Promise<void> {
  const state = useLibraryStore.getState();
  const owner = state.ownerId;
  const ledger = loadLedger(owner);
  const now = Date.now();
  // Only shows grouped by their progress — a manual "Stopped watching" /
  // "Continue later" status decides its own group, so its total can wait until
  // the show is viewed. Diverged shows first (visible now), then least recent.
  const isDiverged = (s: TrackedShow) => diverged(s, ledger.shows[s.id]);
  const order = (s: TrackedShow) => (isDiverged(s) ? -1 : (ledger.shows[s.id]?.[0] ?? 0));
  const dueShows = Object.values(state.trackedShows)
    .filter((s) => !s.userStatus && isDue(s, ledger.shows[s.id], now))
    .sort((a, b) => order(a) - order(b));
  if (dueShows.length === 0) return;
  const due = dueShows.map((s) => s.id);
  // A diverged total came from a device that saw different TMDB data — possibly
  // newer than our cached copy — so settle it from the network, not the cache.
  const fresh = new Set(dueShows.filter(isDiverged).map((s) => s.id));
  if (!useShowSchedule.getState().checking) useShowSchedule.setState({ checking: true });

  // Buffered so a run writes the store (re-render + persist + sync push) once per
  // flush rather than once per show.
  const updates: {
    id: number;
    totalEpisodes: number;
    airedEpisodes?: number;
    nextAirDate: string | null;
  }[] = [];
  const flush = () => {
    const batch = updates.splice(0);
    // Never write one account's refresh into another account's library.
    if (batch.length === 0 || useLibraryStore.getState().ownerId !== owner) return;
    useLibraryStore.getState().syncShowsMeta(
      batch.map((u) => ({
        id: u.id,
        totalEpisodes: u.totalEpisodes,
        airedEpisodes: u.airedEpisodes,
      })),
    );
    setNextDates(batch.map((u) => [u.id, u.nextAirDate]));
  };

  let next = 0;
  let failures = 0;
  const worker = async () => {
    while (next < due.length && failures < FAILURE_CAP) {
      const id = due[next++];
      try {
        const tv = await queryClient.fetchQuery({
          queryKey: queryKeys.tv(id),
          queryFn: () => getTv(id),
          staleTime: fresh.has(id) ? 0 : REUSE_MS,
          gcTime: TRANSIENT_GC_MS,
        });
        const totalEpisodes = statusEpisodeTotal(tv);
        updates.push({
          id,
          totalEpisodes,
          airedEpisodes: airedEpisodeCount(tv) ?? undefined,
          nextAirDate: tv.next_episode_to_air?.air_date ?? null,
        });
        const ended =
          (tv.status === 'Ended' || tv.status === 'Canceled') &&
          !tv.in_production &&
          !tv.next_episode_to_air;
        ledger.shows[id] = [Date.now(), ended ? 1 : 0, totalEpisodes];
        failures = 0;
        if (updates.length >= FLUSH_EVERY) flush();
      } catch (e) {
        if (e instanceof TmdbError && e.status === 404) {
          // Gone from TMDB — nothing to refresh; only re-check rarely.
          ledger.shows[id] = [Date.now(), 1];
          failures = 0;
        } else {
          failures += 1;
        }
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
  } finally {
    flush();
    const current = useLibraryStore.getState();
    if (current.ownerId === owner) {
      // Forget shows no longer tracked so neither store grows without bound.
      for (const key of Object.keys(ledger.shows)) {
        if (!current.trackedShows[Number(key)]) delete ledger.shows[key];
      }
      const dates = useShowSchedule.getState().next;
      const stale = Object.keys(dates).filter((key) => !current.trackedShows[Number(key)]);
      if (stale.length > 0) {
        const kept = { ...dates };
        for (const key of stale) delete kept[Number(key)];
        useShowSchedule.setState({ next: kept });
      }
      try {
        storage.set(LEDGER_KEY, JSON.stringify(ledger));
      } catch {
        // Best-effort: a lost ledger only means re-checking sooner.
      }
    }
  }
}
