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

// TMDB movie/show/season detail is effectively immutable, so treat it as fresh
// for a day — remounting a detail (or navigating back) then serves from cache
// instead of re-hitting the network. Airing shows still revalidate in the
// background once stale (stale-while-revalidate) and are refreshed on reconnect.
const DETAIL_STALE_TIME = 1000 * 60 * 60 * 24; // 24h
// Currently-airing shows change (new episodes/seasons), so revalidate them more
// often than ended shows/movies.
const AIRING_STALE_TIME = 1000 * 60 * 60 * 6; // 6h

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
    staleTime: DETAIL_STALE_TIME,
  });
}

export function useShow(id: number) {
  return useQuery({
    queryKey: queryKeys.tv(id),
    queryFn: () => getTv(id),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: (query) => {
      const data = query.state.data;
      return data && (data.status === 'Returning Series' || data.in_production)
        ? AIRING_STALE_TIME
        : DETAIL_STALE_TIME;
    },
  });
}

export function useSeason(tvId: number, seasonNumber: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.season(tvId, seasonNumber),
    queryFn: () => getSeason(tvId, seasonNumber),
    enabled: enabled && Number.isFinite(tvId) && tvId > 0,
    staleTime: DETAIL_STALE_TIME,
  });
}
