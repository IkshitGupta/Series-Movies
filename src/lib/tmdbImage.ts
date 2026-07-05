/**
 * TMDB image URL helpers. TMDB serves images from a CDN at various sizes.
 * Docs: https://developer.themoviedb.org/docs/image-basics
 */

const IMAGE_BASE = 'https://image.tmdb.org/t/p';

export type PosterSize = 'w185' | 'w342' | 'w500' | 'original';
export type StillSize = 'w185' | 'w300' | 'original';
export type ProfileSize = 'w185' | 'h632' | 'original';

export function posterUrl(path: string | null, size: PosterSize = 'w342'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export function stillUrl(path: string | null, size: StillSize = 'w300'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export function profileUrl(path: string | null, size: ProfileSize = 'w185'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}
