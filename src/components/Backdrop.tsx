import { Image } from 'expo-image';
import { StyleSheet, useColorScheme, View, type ViewStyle } from 'react-native';

import { backdropUrl } from '@/lib/tmdbImage';

/**
 * A subtle backdrop hero for detail-screen headers. Renders the TMDB backdrop
 * faintly behind the poster + title and fades it into the page background with a
 * gradient scrim, so the header text stays readable in both light and dark mode.
 * Absolutely positioned — place it as the first child of a `relative` container
 * that wraps the header row. Renders nothing when there's no backdrop.
 *
 * Uses React Native's built-in `experimental_backgroundImage` gradient (New
 * Architecture) so it needs no native gradient dependency / dev-client rebuild.
 */
export function Backdrop({ path }: { path: string | null }) {
  const scheme = useColorScheme();
  const uri = backdropUrl(path, 'w780');
  if (!uri) return null;

  const bg = scheme === 'dark' ? '#000000' : '#fafafa';
  const scrim: ViewStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    experimental_backgroundImage: `linear-gradient(to bottom, transparent 30%, ${bg} 100%)`,
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image
        source={{ uri }}
        contentFit="cover"
        transition={250}
        style={[StyleSheet.absoluteFill, { opacity: scheme === 'dark' ? 0.35 : 0.22 }]}
      />
      <View style={scrim} />
    </View>
  );
}

