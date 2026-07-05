import { useQuery } from '@tanstack/react-query';

import { getMovie, getSeason, getTv, searchMulti } from '@/api/tmdb';
import { normalizeSearchItem } from '@/lib/normalize';
import type { MediaItem } from '@/types';

export const queryKeys = {
  search: (query: string) => ['search', query] as const,
  movie: (id: number) => ['movie', id] as const,
  tv: (id: number) => ['tv', id] as const,
  season: (id: number, seasonNumber: number) => ['tv', id, 'season', seasonNumber] as const,
};

/** Search movies + shows. Disabled until the query has at least 2 characters. */
export function useSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: queryKeys.search(trimmed),
    enabled: trimmed.length >= 2,
    queryFn: async (): Promise<MediaItem[]> => {
      const res = await searchMulti(trimmed);
      return res.results
        .map(normalizeSearchItem)
        .filter((item): item is MediaItem => item !== null);
    },
  });
}

export function useMovie(id: number) {
  return useQuery({
    queryKey: queryKeys.movie(id),
    queryFn: () => getMovie(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useShow(id: number) {
  return useQuery({
    queryKey: queryKeys.tv(id),
    queryFn: () => getTv(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useSeason(tvId: number, seasonNumber: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.season(tvId, seasonNumber),
    queryFn: () => getSeason(tvId, seasonNumber),
    enabled: enabled && Number.isFinite(tvId) && tvId > 0,
  });
}
