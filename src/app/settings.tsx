import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { type ComponentProps, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';

import { buildExportZip, isLibraryEmpty } from '@/lib/libraryBackup';
import { useLibraryStore } from '@/store/useLibraryStore';
import type { ThemePref } from '@/types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

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
      className="flex-row items-center gap-3 rounded-2xl bg-white p-4 active:opacity-80 dark:bg-neutral-900"
      style={{ opacity: busy ? 0.6 : 1 }}>
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: '#E5091420' }}>
        <Ionicons name={icon} size={20} color="#E50914" />
      </View>
      <View className="flex-1">
        <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{title}</Text>
        <Text className="text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color="#E50914" />
      ) : (
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
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
      const file = new File(Paths.document, `moviesserieshub-export-${date}.zip`);
      if (file.exists) file.delete();
      file.create();
      file.write(bytes);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/zip',
          dialogTitle: 'Export your MoviesSeriesHub library',
        });
      } else {
        await Share.share({ url: file.uri, title: 'MoviesSeriesHub export' });
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
                style={{ backgroundColor: active ? '#E50914' : 'transparent' }}>
                <Ionicons name={opt.icon} size={16} color={active ? '#ffffff' : '#6b7280'} />
                <Text
                  className="text-sm font-semibold"
                  style={{ color: active ? '#ffffff' : '#6b7280' }}>
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
    </ScrollView>
  );
}
