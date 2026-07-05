import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';

import { useIsCategorized, useIsInWatchlist, useLibraryStore } from '@/store/useLibraryStore';
import type { MediaItem } from '@/types';

interface WatchlistButtonProps {
  item: MediaItem;
  size?: number;
}

/**
 * Bookmark toggle that adds/removes an item from the single watchlist.
 * Renders nothing once the item is already watched/tracked/categorized.
 */
export function WatchlistButton({ item, size = 26 }: WatchlistButtonProps) {
  const inList = useIsInWatchlist(item.mediaType, item.id);
  const categorized = useIsCategorized(item.mediaType, item.id);
  const addToWatchlist = useLibraryStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useLibraryStore((s) => s.removeFromWatchlist);

  if (categorized) return null;

  return (
    <Pressable
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={inList ? 'Remove from watchlist' : 'Add to watchlist'}
      onPress={() => (inList ? removeFromWatchlist(item.mediaType, item.id) : addToWatchlist(item))}
      className="h-10 w-10 items-center justify-center rounded-full active:opacity-60">
      <Ionicons
        name={inList ? 'bookmark' : 'bookmark-outline'}
        size={size}
        color={inList ? '#E50914' : '#9ca3af'}
      />
    </Pressable>
  );
}
