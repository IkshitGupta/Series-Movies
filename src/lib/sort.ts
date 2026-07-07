/**
 * Sorting for the library list tabs (Movies / Series / Watchlist).
 *
 * Only stored fields are used (title, release year, and a per-tab "recent"
 * timestamp), so sorting never triggers a network request.
 */

export type SortKey = 'recent' | 'title' | 'year';
export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** Default: most recent first (matches the app's prior fixed ordering). */
export const DEFAULT_SORT: SortState = { key: 'recent', dir: 'desc' };

/** The natural starting direction when a sort option is first selected. */
export function defaultDir(key: SortKey): SortDir {
  return key === 'title' ? 'asc' : 'desc';
}

/**
 * Return a new sorted array. `recentOf` supplies the per-tab timestamp used by
 * the "recent" key (watchedAt / lastUpdated / addedAt). Ties break by title for
 * a stable order regardless of direction.
 */
export function sortLibraryItems<T extends { title: string; year: string | null }>(
  items: T[],
  sort: SortState,
  recentOf: (item: T) => number,
): T[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    let cmp: number;
    if (sort.key === 'title') {
      cmp = a.title.localeCompare(b.title);
    } else if (sort.key === 'year') {
      cmp = (Number(a.year) || 0) - (Number(b.year) || 0);
    } else {
      cmp = recentOf(a) - recentOf(b);
    }
    if (cmp === 0) return a.title.localeCompare(b.title);
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}
