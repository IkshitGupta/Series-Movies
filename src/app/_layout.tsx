import '@/global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useLibraryStore } from '@/store/useLibraryStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme();
  const theme = useLibraryStore((s) => s.theme);

  // The persisted preference is the source of truth; drive NativeWind's scheme
  // (and thus every `dark:` variant) from it. `system` follows the device.
  useEffect(() => {
    setColorScheme(theme);
  }, [theme, setColorScheme]);

  const isDark = colorScheme === 'dark';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
            <Stack.Screen name="import" options={{ title: 'Import data' }} />
            <Stack.Screen name="movie/[id]" options={{ title: 'Movie' }} />
            <Stack.Screen name="show/[id]" options={{ title: 'Show' }} />
            <Stack.Screen name="genre/[type]" options={{ title: 'Genre' }} />
          </Stack>
          <StatusBar style={isDark ? 'light' : 'dark'} />
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
