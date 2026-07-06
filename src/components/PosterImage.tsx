import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { posterUrl, type PosterSize } from '@/lib/tmdbImage';

interface PosterImageProps {
  path: string | null;
  size?: PosterSize;
  /** Tailwind classes for the wrapper (control width/height/rounding). */
  className?: string;
}

const BLURHASH_PLACEHOLDER = { blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' };

/**
 * Renders a TMDB poster with a graceful fallback when no image is available.
 * Sizing/rounding is controlled by the wrapper `className`.
 */
export function PosterImage({ path, size = 'w342', className }: PosterImageProps) {
  const uri = posterUrl(path, size);

  return (
    <View className={`overflow-hidden bg-neutral-200 dark:bg-neutral-800 ${className ?? ''}`}>
      {uri ? (
        <Image
          source={{ uri }}
          placeholder={BLURHASH_PLACEHOLDER}
          recyclingKey={uri}
          contentFit="cover"
          transition={200}
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        <View className="h-full w-full items-center justify-center px-1">
          <Text className="text-center text-[10px] text-neutral-500 dark:text-neutral-400">
            No poster
          </Text>
        </View>
      )}
    </View>
  );
}
