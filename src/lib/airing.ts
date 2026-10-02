import type { TmdbNextEpisode, TmdbTvDetails } from '@/types';

export interface UpcomingInfo {
  /** True when the next unaired episode is a season premiere (new season). */
  newSeason: boolean;
  /** ISO date (YYYY-MM-DD) the next episode airs, or null if only known it's returning. */
  date: string | null;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function startOfTodayMs(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

/** Today as a local-calendar `YYYY-MM-DD` (not UTC), for comparing against a
 * show-local episode `air_date`. */
export function localTodayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Upcoming-content info for a show.
 *
 * - If TMDB has a not-yet-aired `next_episode_to_air`, returns it with the air
 *   date (flagging a season premiere as a new season).
 * - Otherwise, if the show is renewed/ongoing (`status === 'Returning Series'`
 *   or `in_production`) but nothing is scheduled yet, returns a dateless
 *   "new season coming".
 * - Returns null for ended/canceled shows with nothing upcoming.
 */
export function getUpcoming(
  tv?: Pick<TmdbTvDetails, 'next_episode_to_air' | 'status' | 'in_production'> | null,
): UpcomingInfo | null {
  const next: TmdbNextEpisode | null | undefined = tv?.next_episode_to_air;
  if (next?.air_date) {
    const when = new Date(`${next.air_date}T00:00:00`).getTime();
    if (!Number.isNaN(when) && when >= startOfTodayMs()) {
      const newSeason = next.episode_number === 1 || next.episode_type === 'premiere';
      return { newSeason, date: next.air_date };
    }
  }
  // Renewed/ongoing but no episode scheduled yet — we still know more is coming.
  if (tv?.status === 'Returning Series' || tv?.in_production) {
    return { newSeason: true, date: null };
  }
  return null;
}

/**
 * Whether a specific episode may be marked watched. Only a *known future*
 * `air_date` blocks it — a missing/unknown date (common on TMDB for older or
 * non-English shows) counts as aired so those episodes stay markable. Compares
 * at local-date granularity.
 */
export function hasEpisodeAired(airDate: string | null | undefined, todayIso?: string): boolean {
  if (!airDate) return true; // unknown date → treat as aired (still markable)
  return airDate <= (todayIso ?? localTodayIso());
}

/** Format an ISO date as e.g. "Aug 12, 2026" without relying on Intl (Hermes-safe). */
export function formatAirDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * Badge label for an unreleased title, e.g. "Releases Dec 15, 2026" (movie) or
 * "Premieres Aug 12, 2026" (TV). Returns null when the title has already
 * released/aired or has no known date (so released/undated titles get no badge).
 */
export function unreleasedLabel(
  mediaType: 'movie' | 'tv',
  date: string | null | undefined,
  todayIso?: string,
): string | null {
  if (hasEpisodeAired(date, todayIso)) return null;
  const verb = mediaType === 'movie' ? 'Releases' : 'Premieres';
  return `${verb} ${formatAirDate(date!)}`;
}

/**
 * Short label for a row/badge, e.g. "New season · Aug 12, 2026",
 * "New episode · Jul 12, 2026", or "New season coming" when undated.
 */
export function upcomingLabel(info: UpcomingInfo): string {
  if (!info.date) return 'New season coming';
  return `${info.newSeason ? 'New season' : 'New episode'} · ${formatAirDate(info.date)}`;
}

/**
 * Number of episodes that have actually aired so far, from `last_episode_to_air`
 * plus the season episode counts — so unaired/announced future episodes aren't
 * counted as "remaining". Returns null when it can't be determined (caller then
 * falls back to `number_of_episodes`).
 */
export function airedEpisodeCount(
  tv?: Pick<TmdbTvDetails, 'seasons' | 'last_episode_to_air'> | null,
): number | null {
  const last = tv?.last_episode_to_air;
  if (!last) return null;
  let count = 0;
  for (const s of tv?.seasons ?? []) {
    if (s.season_number < 1) continue; // skip specials
    if (s.season_number < last.season_number) count += s.episode_count;
    else if (s.season_number === last.season_number) count += Math.max(last.episode_number, 0);
  }
  return count > 0 ? count : null;
}
