import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/**
 * A single pulsing placeholder block. Size/rounding via `className`.
 * (The animated opacity is on a wrapper so NativeWind `className` styling stays
 * on a plain `View`.)
 */
export function Skeleton({ className }: { className?: string }) {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={style}>
      <View className={`bg-neutral-200 dark:bg-neutral-800 ${className ?? ''}`} />
    </Animated.View>
  );
}

/** One list-row placeholder matching {@link MediaCard}'s layout. */
function MediaCardSkeleton() {
  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
      <Skeleton className="h-24 w-16 rounded-xl" />
      <View className="flex-1 gap-2">
        <Skeleton className="h-4 w-3/4 rounded" />
        <Skeleton className="h-3 w-1/3 rounded-full" />
      </View>
    </View>
  );
}

/** A stack of row placeholders for loading media lists (search, discover). */
export function MediaListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View className="gap-2 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <MediaCardSkeleton key={i} />
      ))}
    </View>
  );
}

/** A placeholder for a movie/show detail header while it loads. */
export function DetailHeaderSkeleton() {
  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black">
      <View className="flex-row gap-4 p-4">
        <Skeleton className="h-48 w-32 rounded-2xl" />
        <View className="flex-1 gap-3 pt-1">
          <Skeleton className="h-6 w-3/4 rounded" />
          <Skeleton className="h-4 w-1/2 rounded" />
          <Skeleton className="h-4 w-1/3 rounded" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </View>
      </View>
      <View className="px-4">
        <Skeleton className="h-12 w-full rounded-2xl" />
      </View>
    </View>
  );
}
