import { useQuery } from '@tanstack/react-query';

import {
  discoverByKeyword,
  getMovie,
  getSeason,
  getTrending,
  getTv,
  searchKeyword,
  searchMulti,
} from '@/api/tmdb';
import { discoverItemToMediaItem, normalizeSearchItem } from '@/lib/normalize';
import type { MediaItem, TmdbKeyword } from '@/types';

export const queryKeys = {
  search: (query: string) => ['search', query] as const,
  trending: () => ['trending'] as const,
  keyword: (query: string) => ['keyword', query] as const,
  keywordDiscover: (id: number) => ['keyword-discover', id] as const,
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

export function useTrending() {
  return useQuery({
    queryKey: queryKeys.trending(),
    queryFn: async (): Promise<MediaItem[]> => {
      const res = await getTrending();
      return res.results
        .map(normalizeSearchItem)
        .filter((item): item is MediaItem => item !== null);
    },
    staleTime: 1000 * 60 * 60, // 1h — trending changes slowly
  });
}

/**
 * If the search text exactly matches a TMDB keyword (case-insensitive), return
 * it so the Search screen can offer a "browse this theme" affordance. Being
 * strict avoids offering a theme for ordinary title queries (e.g. "Inception").
 */
export function useKeywordMatch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: queryKeys.keyword(trimmed.toLowerCase()),
    enabled: trimmed.length >= 3,
    staleTime: 1000 * 60 * 60 * 24,
    queryFn: async (): Promise<TmdbKeyword | null> => {
      const res = await searchKeyword(trimmed);
      const lower = trimmed.toLowerCase();
      return res.results.find((k) => k.name.toLowerCase() === lower) ?? null;
    },
  });
}

export function useDiscoverByKeyword(keywordId: number) {
  return useQuery({
    queryKey: queryKeys.keywordDiscover(keywordId),
    enabled: Number.isFinite(keywordId) && keywordId > 0,
    staleTime: 1000 * 60 * 60 * 12,
    queryFn: async (): Promise<MediaItem[]> => {
      const [movies, shows] = await Promise.all([
        discoverByKeyword(keywordId, 'movie'),
        discoverByKeyword(keywordId, 'tv'),
      ]);
      const merged = [
        ...movies.results.map((m) => ({ item: discoverItemToMediaItem(m, 'movie'), pop: m.popularity ?? 0 })),
        ...shows.results.map((s) => ({ item: discoverItemToMediaItem(s, 'tv'), pop: s.popularity ?? 0 })),
      ];
      return merged.sort((a, b) => b.pop - a.pop).map((x) => x.item);
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
