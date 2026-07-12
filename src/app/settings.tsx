import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { type ComponentProps, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';

import { buildExportZip, isLibraryEmpty } from '@/lib/libraryBackup';
import { useLibraryStore } from '@/store/useLibraryStore';
import { syncNow, useSyncStatus } from '@/store/sync';
import { displayName, useAuth, validateUsername } from '@/store/useAuth';
import { hasSupabase, supabase } from '@/api/supabase';
import type { ThemePref } from '@/types';

import { COLORS } from '@/theme/colors';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

// Installed app version, read from the embedded config so the user can confirm an
// update actually applied after installing a new APK.
const APP_VERSION = Constants.expoConfig?.version ?? '—';
const BUILD_NUMBER =
  Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber ?? '—';

const THEME_OPTIONS: { key: ThemePref; label: string; icon: IoniconName }[] = [
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

/** Human-friendly "time since last sync", e.g. "just now" / "5m ago" / "2h ago". */
function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
  busy,
}: {
  icon: IoniconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      className="flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-4 active:opacity-80 dark:border-neutral-800 dark:bg-neutral-900"
      style={{ opacity: busy ? 0.6 : 1 }}>
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: COLORS.brandTint }}>
        <Ionicons name={icon} size={20} color={COLORS.brand} />
      </View>
      <View className="flex-1">
        <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{title}</Text>
        <Text className="text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={COLORS.brand} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
      )}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const { session } = useAuth();
  const syncStatus = useSyncStatus();
  const theme = useLibraryStore((s) => s.theme);
  const setTheme = useLibraryStore((s) => s.setTheme);

  const runSync = () => {
    if (syncStatus.phase === 'syncing') return;
    void syncNow();
  };

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Push any un-synced local changes before the session is torn down so
      // nothing made on this device is lost when signing out.
      await syncNow().catch(() => undefined);
      await supabase.auth.signOut();
      // Session is now cleared → send the user back to the login gate.
      router.replace('/auth');
    } catch {
      Alert.alert('Could not sign out', 'Please try again.');
      setSigningOut(false);
    }
  };

  const openEditName = () => {
    if (!session) return;
    setNameInput(displayName(session.user));
    setEditingName(true);
  };

  const saveUsername = async () => {
    const next = nameInput.trim();
    const err = validateUsername(next);
    if (err) {
      Alert.alert('Invalid username', err);
      return;
    }
    setSavingName(true);
    try {
      const { error } = await supabase.auth.updateUser({ data: { username: next } });
      if (error) {
        Alert.alert('Could not update username', error.message);
        return;
      }
      setEditingName(false);
    } catch {
      Alert.alert('Could not update username', 'Please try again.');
    } finally {
      setSavingName(false);
    }
  };

  const exportData = async () => {
    if (exporting) return;
    const { watchedMovies, trackedShows, watchlist } = useLibraryStore.getState();
    const snapshot = { watchedMovies, trackedShows, watchlist };
    if (isLibraryEmpty(snapshot)) {
      Alert.alert('Nothing to export yet', 'Add movies or shows to your library first.');
      return;
    }
    setExporting(true);
    try {
      const bytes = buildExportZip(snapshot);
      const date = new Date().toISOString().slice(0, 10);
      const file = new File(Paths.document, `seen-it-export-${date}.zip`);
      if (file.exists) file.delete();
      file.create();
      file.write(bytes);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/zip',
          dialogTitle: 'Export your Seen It library',
        });
      } else {
        await Share.share({ url: file.uri, title: 'Seen It export' });
      }
    } catch {
      Alert.alert('Could not export', 'Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-neutral-50 dark:bg-black"
      contentContainerStyle={{ padding: 16, gap: 20 }}>
      {hasSupabase() && session ? (
        <View className="gap-2">
          <Text className="px-1 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
            Account
          </Text>
          <View className="gap-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <View className="flex-row items-center gap-3">
              <View
                className="h-10 w-10 items-center justify-center rounded-full"
                style={{ backgroundColor: COLORS.brandTint }}>
                <Ionicons name="person" size={20} color={COLORS.brand} />
              </View>
              <View className="flex-1">
                <Text
                  numberOfLines={1}
                  className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                  {displayName(session.user)}
                </Text>
                <Text
                  numberOfLines={1}
                  className="text-xs text-neutral-500 dark:text-neutral-400">
                  {session.user.email}
                </Text>
              </View>
              <Pressable
                onPress={openEditName}
                hitSlop={8}
                accessibilityLabel="Edit username"
                className="h-9 w-9 items-center justify-center rounded-full active:opacity-60">
                <Ionicons name="pencil" size={17} color={COLORS.muted} />
              </Pressable>
            </View>
            <Pressable
              onPress={runSync}
              disabled={syncStatus.phase === 'syncing'}
              className="flex-row items-center justify-center gap-2 rounded-xl bg-neutral-100 py-3 active:opacity-70 dark:bg-neutral-800/60">
              {syncStatus.phase === 'syncing' ? (
                <ActivityIndicator size="small" color={COLORS.brand} />
              ) : (
                <Ionicons
                  name={syncStatus.phase === 'error' ? 'cloud-offline-outline' : 'cloud-done-outline'}
                  size={18}
                  color={syncStatus.phase === 'error' ? COLORS.muted : COLORS.brand}
                />
              )}
              <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                {syncStatus.phase === 'syncing'
                  ? 'Syncing…'
                  : syncStatus.phase === 'error'
                    ? 'Sync failed — tap to retry'
                    : syncStatus.lastSyncedAt
                      ? `Synced ${timeAgo(syncStatus.lastSyncedAt)}`
                      : 'Sync now'}
              </Text>
            </Pressable>
            <Pressable
              onPress={signOut}
              disabled={signingOut}
              className="flex-row items-center justify-center gap-2 rounded-xl bg-neutral-200 py-3 active:opacity-70 dark:bg-neutral-800">
              {signingOut ? (
                <ActivityIndicator size="small" color={COLORS.brand} />
              ) : (
                <Ionicons name="log-out-outline" size={18} color={COLORS.brand} />
              )}
              <Text className="text-sm font-semibold text-brand">Sign out</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View className="gap-2">
        <Text className="px-1 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
          Appearance
        </Text>
        <View className="flex-row gap-2 rounded-2xl bg-neutral-200 p-1 dark:bg-neutral-800">
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setTheme(opt.key)}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl py-2.5 active:opacity-80"
                style={{ backgroundColor: active ? COLORS.brand : 'transparent' }}>
                <Ionicons name={opt.icon} size={16} color={active ? COLORS.white : COLORS.mutedDark} />
                <Text
                  className="text-sm font-semibold"
                  style={{ color: active ? COLORS.white : COLORS.mutedDark }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="gap-2">
        <Text className="px-1 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
          Data
        </Text>
        <View className="gap-2">
          <SettingsRow
            icon="cloud-upload-outline"
            title="Import data"
            subtitle="Load a data export (.zip)"
            onPress={() => router.push('/import')}
          />
          <SettingsRow
            icon="cloud-download-outline"
            title="Export data"
            subtitle="Save your library to a file you can re-import"
            onPress={exportData}
            busy={exporting}
          />
        </View>
      </View>

      <View className="items-center pt-2">
        <Text className="text-xs text-neutral-400 dark:text-neutral-500">
          Seen It · v{APP_VERSION} (build {BUILD_NUMBER})
        </Text>
      </View>

      <Modal
        visible={editingName}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingName(false)}>
        <Pressable
          onPress={() => setEditingName(false)}
          className="flex-1 items-center justify-center bg-black/50 px-8">
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="w-full gap-4 rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
              Edit username
            </Text>
            <TextInput
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Username"
              placeholderTextColor={COLORS.muted}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={20}
              className="rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50"
            />
            <View className="flex-row justify-end gap-2">
              <Pressable
                onPress={() => setEditingName(false)}
                className="rounded-xl px-4 py-2.5 active:opacity-70">
                <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={saveUsername}
                disabled={savingName}
                className="min-w-20 flex-row items-center justify-center rounded-xl px-4 py-2.5 active:opacity-80"
                style={{ backgroundColor: COLORS.brand }}>
                {savingName ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Text className="text-sm font-semibold text-white">Save</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
