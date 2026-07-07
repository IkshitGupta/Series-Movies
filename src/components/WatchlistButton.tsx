import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { useIsCategorized, useIsInWatchlist, useLibraryStore } from '@/store/useLibraryStore';
import type { MediaItem } from '@/types';

import { COLORS } from '@/theme/colors';

interface WatchlistButtonProps {
  item: MediaItem;
  size?: number;
  /**
   * When the item is already in the library (watched/tracked), show a muted
   * "in library" marker instead of rendering nothing — keeps list rows aligned
   * and signals you've already seen it. Off by default (detail screens hide it).
   */
  showCategorizedState?: boolean;
}

/**
 * Bookmark toggle that adds/removes an item from the single watchlist.
 * Renders nothing once the item is already watched/tracked/categorized (unless
 * {@link WatchlistButtonProps.showCategorizedState} is set).
 */
export function WatchlistButton({ item, size = 26, showCategorizedState = false }: WatchlistButtonProps) {
  const inList = useIsInWatchlist(item.mediaType, item.id);
  const categorized = useIsCategorized(item.mediaType, item.id);
  const addToWatchlist = useLibraryStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useLibraryStore((s) => s.removeFromWatchlist);

  if (categorized) {
    if (!showCategorizedState) return null;
    return (
      <View
        accessibilityLabel="Already in your library"
        className="h-10 w-10 items-center justify-center">
        <Ionicons name="checkmark-circle" size={size} color={COLORS.muted} />
      </View>
    );
  }

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
        color={inList ? COLORS.brand : COLORS.muted}
      />
    </Pressable>
  );
}
