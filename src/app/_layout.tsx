import '@/global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { flushQueryCache, hydrateQueryCache, startQueryCachePersistence } from '@/store/queryPersist';
import { flushPendingWrites, trimStorage } from '@/store/storage';
import { useSyncEngine } from '@/store/sync';
import { useLibraryStore } from '@/store/useLibraryStore';

import { WebFrame } from '@/components/WebFrame';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      // Keep fetched data in memory for a day so navigating back to a detail
      // (or re-opening it) serves from cache instead of re-hitting TMDB.
      gcTime: 1000 * 60 * 60 * 24,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Restore the persisted TMDB cache before anything subscribes, so previously
// opened detail renders instantly (and offline) on a cold start.
hydrateQueryCache(queryClient);

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme();
  const theme = useLibraryStore((s) => s.theme);

  // Keep the local library mirrored to the signed-in account across devices.
  useSyncEngine();

  // The persisted preference is the source of truth; drive NativeWind's scheme
  // (and thus every `dark:` variant) from it. `system` follows the device.
  useEffect(() => {
    setColorScheme(theme);
  }, [theme, setColorScheme]);

  // Storage housekeeping: reclaim MMKV's file space once after hydration, and
  // flush any coalesced write when the app is backgrounded so nothing is lost.
  useEffect(() => {
    const trimTimer = setTimeout(trimStorage, 1000);
    const stopQueryPersist = startQueryCachePersistence(queryClient);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        flushPendingWrites();
        flushQueryCache();
      }
    });
    return () => {
      clearTimeout(trimTimer);
      stopQueryPersist();
      sub.remove();
    };
  }, []);

  const isDark = colorScheme === 'dark';

  return (
    <>
      <Head>
        <title>Seen It — Track movies &amp; TV shows</title>
        <meta
          name="description"
          content="Track the movies and TV shows you've watched, keep a watchlist, and sync your library across devices with Seen It."
        />
        <meta name="theme-color" content="#010102" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Seen It" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
            <WebFrame isDark={isDark}>
              <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="auth" options={{ headerShown: false }} />
                <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                <Stack.Screen name="settings" options={{ title: 'Settings' }} />
                <Stack.Screen name="import" options={{ title: 'Import data' }} />
                <Stack.Screen name="movie/[id]" options={{ title: 'Movie' }} />
                <Stack.Screen name="show/[id]" options={{ title: 'Show' }} />
                <Stack.Screen name="genre/[type]" options={{ title: 'Genre' }} />
                <Stack.Screen name="person/[id]" options={{ title: 'Cast' }} />
                <Stack.Screen name="keyword/[id]" options={{ title: 'Theme' }} />
              </Stack>
            </WebFrame>
            <StatusBar style={isDark ? 'light' : 'dark'} />
          </ThemeProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </>
  );
}
