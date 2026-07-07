import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { stillUrl } from '@/lib/tmdbImage';
import { COLORS } from '@/theme/colors';

interface EpisodeRowProps {
  episodeNumber: number;
  title: string;
  subtitle?: string;
  stillPath?: string | null;
  watched: boolean;
  onToggle: (episodeNumber: number) => void;
  /** Mark this episode and every earlier one (incl. previous seasons) as watched. */
  onWatchTillHere?: (episodeNumber: number) => void;
  busy?: boolean;
}

export const EpisodeRow = memo(function EpisodeRow({
  episodeNumber,
  title,
  subtitle,
  stillPath,
  watched,
  onToggle,
  onWatchTillHere,
  busy,
}: EpisodeRowProps) {
  const still = stillUrl(stillPath ?? null);

  return (
    <View className="flex-row items-center gap-2 py-2">
      <Pressable
        onPress={() => onToggle(episodeNumber)}
        className="flex-1 flex-row items-center gap-3 active:opacity-70">
        <View className="h-12 w-20 items-center justify-center overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800">
          {still ? (
            <Image
              source={{ uri: still }}
              contentFit="cover"
              recyclingKey={still}
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              {episodeNumber}
            </Text>
          )}
        </View>

        <View className="flex-1">
          <Text
            numberOfLines={1}
            className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
            {episodeNumber}. {title}
          </Text>
          {subtitle ? (
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</Text>
          ) : null}
        </View>
      </Pressable>

      {onWatchTillHere ? (
        <Pressable
          onPress={() => onWatchTillHere(episodeNumber)}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Mark watched up to here"
          className="p-1 active:opacity-60">
          {busy ? (
            <ActivityIndicator size="small" color={COLORS.muted} />
          ) : (
            <Ionicons name="arrow-up-circle-outline" size={22} color={COLORS.muted} />
          )}
        </Pressable>
      ) : null}

      <Pressable onPress={() => onToggle(episodeNumber)} hitSlop={6} className="active:opacity-60">
        <Ionicons
          name={watched ? 'checkmark-circle' : 'ellipse-outline'}
          size={26}
          color={watched ? COLORS.brand : COLORS.muted}
        />
      </Pressable>
    </View>
  );
});
