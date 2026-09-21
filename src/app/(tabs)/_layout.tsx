import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, View, type ColorValue } from 'react-native';

import { useLibraryStore, useStoreHydrated } from '@/store/useLibraryStore';
import { useAuth } from '@/store/useAuth';
import { syncNow, useSyncStatus } from '@/store/sync';
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

/**
 * Full-screen hold shown while the first cloud sync of a returning account is in
 * flight (so its data can auto-dismiss onboarding). Falls back to a retry /
 * "continue offline" escape if the sync errors or hangs, so a flaky network can
 * never wedge the user on an endless spinner.
 */
function FirstSyncGate({ onContinue }: { onContinue: () => void }) {
  const phase = useSyncStatus((s) => s.phase);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);
  const stuck = timedOut || phase === 'error';
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-neutral-50 px-8 dark:bg-black">
      <ActivityIndicator size="large" color={COLORS.brand} />
      {stuck ? (
        <View className="items-center gap-3">
          <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">
            Couldn’t reach the cloud. Check your connection and retry, or continue
            offline — your data will sync when you’re back online.
          </Text>
          <View className="flex-row gap-3">
            <Pressable
              onPress={() => void syncNow()}
              className="rounded-full bg-neutral-200 px-4 py-2 active:opacity-70 dark:bg-neutral-800">
              <Text className="text-sm font-semibold text-brand">Retry</Text>
            </Pressable>
            <Pressable
              onPress={onContinue}
              className="rounded-full px-4 py-2 active:opacity-70"
              style={{ backgroundColor: COLORS.brand }}>
              <Text className="text-sm font-semibold text-white">Continue offline</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Full-screen hold shown right after an account switch, while the sync engine
 * reconciles library ownership (so account B never sees account A's library).
 * `ensureOwner` normally clears it within a render; if that reconcile was skipped
 * (a sync was in flight) and the follow-up sync errors/hangs, a Retry escape
 * kicks off a fresh sync rather than leaving an endless spinner.
 */
function OwnerSwitchGate() {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-neutral-50 px-8 dark:bg-black">
      <ActivityIndicator size="large" color={COLORS.brand} />
      {timedOut ? (
        <View className="items-center gap-3">
          <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">
            Switching accounts is taking longer than expected.
          </Text>
          <Pressable
            onPress={() => void syncNow()}
            className="rounded-full px-4 py-2 active:opacity-70"
            style={{ backgroundColor: COLORS.brand }}>
            <Text className="text-sm font-semibold text-white">Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function TabsLayout() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const onboarded = useLibraryStore((s) => s.onboarded);
  const ownerId = useLibraryStore((s) => s.ownerId);
  const { session, loading: authLoading } = useAuth();
  const lastSyncedAt = useSyncStatus((s) => s.lastSyncedAt);
  const [bypassSync, setBypassSync] = useState(false);

  // Wait for MMKV rehydration + the initial auth check before deciding.
  if (!hydrated || authLoading) return null;
  // Account-only: require a signed-in session (when sync is configured).
  if (hasSupabase() && !session) return <Redirect href="/auth" />;
  // Just switched accounts on this device: the loaded library still belongs to
  // the previous user. Hold until the sync engine reconciles ownership so we
  // never flash account A's library to account B (a privacy leak on shared
  // browsers on the web build).
  if (hasSupabase() && session && ownerId != null && ownerId !== session.user.id) {
    return <OwnerSwitchGate />;
  }
  // Signed in but not yet onboarded on this device: hold for the first cloud
  // sync so a returning account's data can auto-dismiss onboarding (see
  // sync.applyRemote) instead of wrongly showing "import / start fresh".
  const awaitingFirstSync = hasSupabase() && !!session && lastSyncedAt == null && !bypassSync;
  if (!onboarded && awaitingFirstSync) {
    return <FirstSyncGate onContinue={() => setBypassSync(true)} />;
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
