import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { type ComponentProps } from 'react';
import { Pressable, type ColorValue } from 'react-native';

import { useLibraryStore, useStoreHydrated } from '@/store/useLibraryStore';
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

  // Wait for MMKV rehydration before deciding, then show first-launch onboarding.
  if (!hydrated) return null;
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
