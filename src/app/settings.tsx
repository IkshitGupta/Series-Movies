import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { type ComponentProps, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';

import { buildExportZip, isLibraryEmpty } from '@/lib/libraryBackup';
import { useLibraryStore } from '@/store/useLibraryStore';
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
  const theme = useLibraryStore((s) => s.theme);
  const setTheme = useLibraryStore((s) => s.setTheme);

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
    </ScrollView>
  );
}
