/**
 * Resolve the "next" unwatched episode for a tracked show, so the Series list
 * can offer a one-tap "mark next episode watched" action.
 */
import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/queries';
import { getSeason, getTv } from '@/api/tmdb';
import { airedEpisodeCount, hasEpisodeAired, localTodayIso } from '@/lib/airing';
import { episodeKey, type TmdbTvDetails } from '@/types';

export interface NextEpisode {
  season: number;
  episode: number;
  /** Episode runtime in minutes (from TMDB), or null if unknown. */
  runtime: number | null;
}

/** The show is up to date on everything aired so far (nothing new to watch yet). */
export type NextUp =
  | { kind: 'next'; season: number; episode: number }
  | { kind: 'caught-up' };

/**
 * Cheap, synchronous "next unwatched aired episode" for the Series list — derived
 * from the show's season summaries (episode counts), so it needs no extra fetch
 * beyond the detail the row already loads. Matches the async {@link findNextEpisode}
 * for standard 1..N episode numbering. Returns `caught-up` once every *aired*
 * episode is watched (so unaired future episodes aren't offered as "next").
 */
export function nextUnwatchedEpisode(watchedEpisodes: string[], details: TmdbTvDetails): NextUp {
  // Prefer the exact aired count. Otherwise treat the show as fully-aired unless
  // its premiere date is known and still in the future (only then is 0 correct);
  // a show missing both `last_episode_to_air` and `first_air_date` falls back to
  // its total rather than wrongly reporting "caught up".
  const knownFuture = !!details.first_air_date && details.first_air_date > localTodayIso();
  const aired = airedEpisodeCount(details) ?? (knownFuture ? 0 : details.number_of_episodes);
  const watched = new Set(watchedEpisodes);
  const seasons = details.seasons
    .filter((s) => s.season_number >= 1 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number);
  // Walk episodes in order but only within the aired window, so an inflated
  // imported watched-count (TheTVDB split episodes TMDB merges) can't falsely
  // report "caught up" while real aired episodes are still unwatched — and an
  // unaired future episode is never offered as "next".
  let seen = 0;
  for (const s of seasons) {
    for (let e = 1; e <= s.episode_count; e += 1) {
      if (seen >= aired) return { kind: 'caught-up' };
      seen += 1;
      if (!watched.has(episodeKey(s.season_number, e))) {
        return { kind: 'next', season: s.season_number, episode: e };
      }
    }
  }
  return { kind: 'caught-up' };
}

/**
 * Find the first unwatched episode (in season/episode order) for a show.
 *
 * Uses TMDB season summaries to skip already-completed seasons cheaply, then
 * fetches only the first incomplete season to read real episode numbers.
 * Returns null when every episode is already watched.
 */
export async function findNextEpisode(
  queryClient: QueryClient,
  showId: number,
  watchedEpisodes: string[],
): Promise<NextEpisode | null> {
  const watched = new Set(watchedEpisodes);

  const details = await queryClient.fetchQuery({
    queryKey: queryKeys.tv(showId),
    queryFn: () => getTv(showId),
  });

  const seasons = details.seasons
    .filter((s) => s.season_number >= 1 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number);

  for (const summary of seasons) {
    const prefix = `S${summary.season_number}E`;
    const watchedInSeason = [...watched].filter((k) => k.startsWith(prefix)).length;
    if (watchedInSeason >= summary.episode_count) continue; // season already complete

    const season = await queryClient.fetchQuery({
      queryKey: queryKeys.season(showId, summary.season_number),
      queryFn: () => getSeason(showId, summary.season_number),
    });

    const episodes = [...season.episodes].sort((a, b) => a.episode_number - b.episode_number);
    for (const ep of episodes) {
      // Never offer an unaired episode as "next" — you can't have watched it
      // yet, and everything after it airs later, so we're caught up.
      if (!hasEpisodeAired(ep.air_date)) return null;
      if (!watched.has(episodeKey(ep.season_number, ep.episode_number))) {
        return { season: ep.season_number, episode: ep.episode_number, runtime: ep.runtime };
      }
    }
  }

  return null;
}
