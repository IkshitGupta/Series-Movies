/**
 * Resolve the "next" unwatched episode for a tracked show, so the Series list
 * can offer a one-tap "mark next episode watched" action.
 */
import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/queries';
import { getSeason, getTv } from '@/api/tmdb';
import { airedEpisodeCount } from '@/lib/airing';
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
  const aired = airedEpisodeCount(details) ?? details.number_of_episodes;
  if (watchedEpisodes.length >= aired) return { kind: 'caught-up' };
  const watched = new Set(watchedEpisodes);
  const seasons = details.seasons
    .filter((s) => s.season_number >= 1 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number);
  for (const s of seasons) {
    for (let e = 1; e <= s.episode_count; e += 1) {
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
      if (!watched.has(episodeKey(ep.season_number, ep.episode_number))) {
        return { season: ep.season_number, episode: ep.episode_number, runtime: ep.runtime };
      }
    }
  }

  return null;
}
