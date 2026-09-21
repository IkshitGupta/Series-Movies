import type {
  CastCredit,
  MediaItem,
  TmdbCastMember,
  TmdbDiscoverItem,
  TmdbMovieDetails,
  TmdbSearchItem,
  TmdbTvDetails,
} from '@/types';

/** How many top-billed cast members to keep on a library item. Deep enough to
 * cover a title's leads/main supporting cast without dredging up bit parts;
 * minor one-off actors still stay low in the stat since it ranks by how many
 * watched titles each appears in. */
export const MAX_CAST = 10;

/** Extract a 4-digit year from a TMDB `YYYY-MM-DD` date string. */
export function yearFromDate(date?: string | null): string | null {
  return date ? date.slice(0, 4) || null : null;
}

/** Top-billed cast from a detail response, trimmed to id + name (deduped). */
export function topCast(detail: { credits?: { cast?: TmdbCastMember[] } }): CastCredit[] | undefined {
  const cast = detail.credits?.cast;
  if (!cast || cast.length === 0) return undefined;
  const seen = new Set<number>();
  const out: CastCredit[] = [];
  for (const c of cast) {
    if (!c || !c.name || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, name: c.name });
    if (out.length >= MAX_CAST) break;
  }
  return out.length > 0 ? out : undefined;
}

/** Normalize a `/search/multi` result, dropping people. */
export function normalizeSearchItem(item: TmdbSearchItem): MediaItem | null {
  if (item.media_type !== 'movie' && item.media_type !== 'tv') return null;
  return {
    id: item.id,
    mediaType: item.media_type,
    title: item.title ?? item.name ?? 'Untitled',
    posterPath: item.poster_path,
    year: yearFromDate(item.release_date ?? item.first_air_date),
  };
}

export function movieToMediaItem(movie: TmdbMovieDetails): MediaItem {
  return {
    id: movie.id,
    mediaType: 'movie',
    title: movie.title,
    posterPath: movie.poster_path,
    year: yearFromDate(movie.release_date),
    genres: movie.genres.map((g) => g.name),
    cast: topCast(movie),
  };
}

export function tvToMediaItem(show: TmdbTvDetails): MediaItem {
  return {
    id: show.id,
    mediaType: 'tv',
    title: show.name,
    posterPath: show.poster_path,
    year: yearFromDate(show.first_air_date),
    genres: show.genres.map((g) => g.name),
    cast: topCast(show),
  };
}

/** Normalize a `/discover/{movie|tv}` result (which carries no `media_type`). */
export function discoverItemToMediaItem(
  item: TmdbDiscoverItem,
  mediaType: 'movie' | 'tv',
): MediaItem {
  return {
    id: item.id,
    mediaType,
    title: item.title ?? item.name ?? 'Untitled',
    posterPath: item.poster_path,
    year: yearFromDate(item.release_date ?? item.first_air_date),
  };
}
