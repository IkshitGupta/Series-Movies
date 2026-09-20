import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, View, type ColorValue } from 'react-native';

import { useLibraryStore, useStoreHydrated } from '@/store/useLibraryStore';
import { useAuth } from '@/store/useAuth';
import { useSyncStatus } from '@/store/sync';
import { hasSupabase } from '@/api/supabase';
import { COLORS } from '@/theme/colors';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function makeTabIcon(name: IoniconName) {
  const TabBarIcon = ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );
  TabBarIcon.displayName = `TabBarIcon(${name})`;
  return TabBarIcon;
}

export default function TabsLayout() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const onboarded = useLibraryStore((s) => s.onboarded);
  const { session, loading: authLoading } = useAuth();
  const lastSyncedAt = useSyncStatus((s) => s.lastSyncedAt);
  const syncPhase = useSyncStatus((s) => s.phase);

  // Wait for MMKV rehydration + the initial auth check before deciding.
  if (!hydrated || authLoading) return null;
  // Account-only: require a signed-in session (when sync is configured).
  if (hasSupabase() && !session) return <Redirect href="/auth" />;
  // Signed in but not yet onboarded on this device: hold for the first cloud
  // sync so a returning account's data can auto-dismiss onboarding (see
  // sync.applyRemote) instead of wrongly showing "import / start fresh".
  const awaitingFirstSync =
    hasSupabase() && !!session && lastSyncedAt == null && syncPhase !== 'error';
  if (!onboarded && awaitingFirstSync) {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-50 dark:bg-black">
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }
  // First-launch onboarding (import offer) for genuinely new / empty accounts.
  if (!onboarded) return <Redirect href="/onboarding" />;

  const settingsButton = () => (
    <Pressable
      onPress={() => router.push('/settings')}
      hitSlop={12}
      style={{ paddingHorizontal: 12, opacity: 1 }}>
      <Ionicons name="settings-outline" size={22} color={COLORS.brand} />
    </Pressable>
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.brand,
        headerTitleStyle: { fontWeight: '700' },
        headerRight: settingsButton,
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Search', tabBarIcon: makeTabIcon('search') }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{ title: 'Watchlist', tabBarIcon: makeTabIcon('bookmark') }}
      />
      <Tabs.Screen
        name="movies"
        options={{ title: 'Movies', tabBarIcon: makeTabIcon('film') }}
      />
      <Tabs.Screen
        name="series"
        options={{ title: 'Series', tabBarIcon: makeTabIcon('tv') }}
      />
      <Tabs.Screen
        name="stats"
        options={{ title: 'Stats', tabBarIcon: makeTabIcon('stats-chart') }}
      />
    </Tabs>
  );
}
