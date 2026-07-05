/**
 * Resolve the "next" unwatched episode for a tracked show, so the Series list
 * can offer a one-tap "mark next episode watched" action.
 */
import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/queries';
import { getSeason, getTv } from '@/api/tmdb';
import { episodeKey } from '@/types';

export interface NextEpisode {
  season: number;
  episode: number;
  /** Episode runtime in minutes (from TMDB), or null if unknown. */
  runtime: number | null;
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
