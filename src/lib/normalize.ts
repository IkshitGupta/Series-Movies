import type {
  CastCredit,
  MediaItem,
  TmdbCastMember,
  TmdbDiscoverItem,
  TmdbMovieDetails,
  TmdbSearchItem,
  TmdbTvDetails,
} from '@/types';

/** Total cast members kept per title for the actor stat / filmography. A blend of
 * the top-billed leads plus the most-popular of the rest, so a headline star
 * billed low in a big ensemble (e.g. Zendaya, 33rd in *The Odyssey*) still shows,
 * while true bit parts (low billing AND low fame) are dropped. */
export const MAX_CAST = 12;

/** Of {@link MAX_CAST}, the slots guaranteed to the top-billed cast (the real
 * leads / supporting cast, even when their current popularity is low). The rest
 * are filled by TMDB `popularity` to surface recognizable low-billed actors. */
const BILLING_LEADS = 8;

/** Extract a 4-digit year from a TMDB `YYYY-MM-DD` date string. */
export function yearFromDate(date?: string | null): string | null {
  return date ? date.slice(0, 4) || null : null;
}

/**
 * Cast to keep for a title, as `{id, name}`. Takes the top {@link BILLING_LEADS}
 * by billing order, then fills up to {@link MAX_CAST} with the most-popular of the
 * remaining cast (ties broken by billing). De-duped and emitted in billing order
 * so the stored list is canonical (stable across devices for the merge).
 */
export function topCast(detail: { credits?: { cast?: TmdbCastMember[] } }): CastCredit[] | undefined {
  const cast = detail.credits?.cast;
  if (!cast || cast.length === 0) return undefined;
  // De-dupe by id, then order by billing (TMDB usually pre-sorts; be defensive).
  const seen = new Set<number>();
  const ordered: TmdbCastMember[] = [];
  for (const c of cast) {
    if (!c || !c.name || seen.has(c.id)) continue;
    seen.add(c.id);
    ordered.push(c);
  }
  if (ordered.length === 0) return undefined;
  ordered.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

  const chosen = new Set<number>(ordered.slice(0, BILLING_LEADS).map((c) => c.id));
  const remainingSlots = MAX_CAST - chosen.size;
  if (remainingSlots > 0) {
    const fill = ordered
      .filter((c) => !chosen.has(c.id))
      .sort(
        (a, b) =>
          (b.popularity ?? 0) - (a.popularity ?? 0) ||
          (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER),
      )
      .slice(0, remainingSlots);
    for (const c of fill) chosen.add(c.id);
  }
  const out = ordered.filter((c) => chosen.has(c.id)).map((c) => ({ id: c.id, name: c.name }));
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
    releaseDate: item.release_date || item.first_air_date || null,
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
    releaseDate: item.release_date || item.first_air_date || null,
  };
}
