import { Ionicons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { MediaItem } from '@/types';

import { PosterImage } from './PosterImage';
import { StatusBadge } from './StatusBadge';

interface MediaCardProps {
  item: MediaItem;
  onPress?: () => void;
  /** Optional trailing accessory (actions, chevron, status). */
  right?: ReactNode;
  /** Optional secondary line, e.g. progress text. */
  subtitle?: string;
  /** Optional accent pill, e.g. "New season · Aug 12, 2026". */
  badge?: string;
}

export function MediaCard({ item, onPress, right, subtitle, badge }: MediaCardProps) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl bg-white p-2 active:opacity-70 dark:bg-neutral-900">
      <PosterImage path={item.posterPath} size="w185" className="h-24 w-16 rounded-xl" />

      <View className="flex-1 gap-1">
        <Text
          numberOfLines={2}
          className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {item.title}
        </Text>
        <View className="flex-row items-center gap-2">
          <StatusBadge
            label={item.mediaType === 'movie' ? 'Movie' : 'TV'}
            tone={item.mediaType === 'movie' ? 'info' : 'brand'}
          />
          {item.year ? (
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">{item.year}</Text>
          ) : null}
        </View>
        {subtitle ? (
          <Text numberOfLines={1} className="text-xs text-neutral-500 dark:text-neutral-400">
            {subtitle}
          </Text>
        ) : null}
        {badge ? (
          <View className="flex-row items-center gap-1">
            <Ionicons name="calendar-outline" size={12} color="#E50914" />
            <Text numberOfLines={1} className="text-xs font-semibold text-brand">
              {badge}
            </Text>
          </View>
        ) : null}
      </View>

      {right ? <View className="pl-1">{right}</View> : null}
    </Pressable>
  );
}
