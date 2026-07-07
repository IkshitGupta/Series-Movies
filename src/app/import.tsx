import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';

import {
  buildUnmatchedCsv,
  parseTvTimeZip,
  resolveLibrary,
  type ImportProgress,
  type ImportResult,
} from '@/lib/tvtimeImport';
import { useLibraryStore } from '@/store/useLibraryStore';

import { COLORS } from '@/theme/colors';

type Phase = 'idle' | 'working' | 'done' | 'error';

const PHASE_LABELS: Record<string, string> = {
  reading: 'Reading the ZIP file…',
  parsing: 'Parsing your library…',
  resolving: 'Matching movies & shows on TMDB…',
};

export default function ImportScreen() {
  const router = useRouter();
  const importLibrary = useLibraryStore((s) => s.importLibrary);
  const setOnboarded = useLibraryStore((s) => s.setOnboarded);

  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState<string>('reading');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const pickAndImport = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;

      setPhase('working');
      setProgress(null);
      setStep('reading');
      const bytes = await new File(picked.assets[0].uri).bytes();

      setStep('parsing');
      // Yield so the UI can paint the "parsing" label before the sync unzip.
      await new Promise<void>((r) => setTimeout(r, 0));
      const parsed = parseTvTimeZip(bytes);
      if (parsed.movies.length === 0 && parsed.shows.length === 0) {
        throw new Error('No movies or shows were found in this export.');
      }

      setStep('resolving');
      const resolved = await resolveLibrary(parsed, setProgress);
      importLibrary({
        shows: resolved.shows,
        movies: resolved.movies,
        watchlist: resolved.watchlist,
      });
      setResult(resolved);
      setPhase('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong during import.');
      setPhase('error');
    }
  };

  const downloadReport = async () => {
    if (!result || result.unmatched.length === 0) return;
    const csv = buildUnmatchedCsv(result.unmatched);
    try {
      const file = new File(Paths.document, 'unmatched-items.csv');
      if (file.exists) file.delete();
      file.create();
      file.write(csv);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: 'Items not imported',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        await Share.share({ message: csv, title: 'Items not imported' });
      }
    } catch {
      // Last-resort fallback: hand the raw CSV text to any app.
      await Share.share({ message: csv }).catch(() => {
        Alert.alert('Could not export the report', 'Please try again.');
      });
    }
  };

  const finish = () => {
    setOnboarded(true);
    router.replace('/(tabs)');
  };

  // -- Working (progress) ---------------------------------------------------
  if (phase === 'working') {
    const pct = progress && progress.total > 0 ? progress.processed / progress.total : 0;
    return (
      <View className="flex-1 items-center justify-center gap-5 bg-neutral-50 px-8 dark:bg-black">
        <ActivityIndicator size="large" color={COLORS.brand} />
        <Text className="text-center text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          {PHASE_LABELS[step] ?? 'Working…'}
        </Text>
        {step === 'resolving' && progress ? (
          <View className="w-full gap-2">
            <View className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <View
                className="h-2 rounded-full"
                style={{ width: `${Math.round(pct * 100)}%`, backgroundColor: COLORS.brand }}
              />
            </View>
            <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">
              {progress.processed} / {progress.total} items
              {progress.currentTitle ? ` · ${progress.currentTitle}` : ''}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  // -- Done (summary + report) ---------------------------------------------
  if (phase === 'done' && result) {
    const { counts } = result;
    const unmatchedCount = result.unmatched.length;
    const summaryParts = [
      `${counts.movies} ${counts.movies === 1 ? 'movie' : 'movies'}`,
      `${counts.shows} ${counts.shows === 1 ? 'show' : 'shows'}`,
      `${counts.episodes} episodes`,
    ];
    return (
      <ScrollView
        className="flex-1 bg-neutral-50 dark:bg-black"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
        <View className="items-center gap-2">
          <Ionicons name="checkmark-circle" size={56} color={COLORS.success} />
          <Text className="text-center text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            Import complete
          </Text>
          <Text className="text-center text-base text-neutral-500 dark:text-neutral-400">
            Imported {summaryParts.join(' · ')}
          </Text>
          {counts.watchlist > 0 ? (
            <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">
              {counts.watchlist} added to your watchlist
            </Text>
          ) : null}
          <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">
            {unmatchedCount > 0
              ? `${unmatchedCount} couldn't be matched`
              : 'Everything matched 🎉'}
          </Text>
        </View>

        {unmatchedCount > 0 ? (
          <View className="gap-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
              Couldn&apos;t be imported ({unmatchedCount})
            </Text>
            {result.unmatched.map((u) => (
              <View key={`${u.type}-${u.identifier}-${u.title}`} className="gap-0.5">
                <Text className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                  {u.title} <Text className="text-neutral-400">· {u.type}</Text>
                </Text>
                <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                  {u.reason}
                  {u.type === 'show' ? ` · ${u.episodesWatched} episodes lost` : ''}
                </Text>
              </View>
            ))}
            <Pressable
              onPress={downloadReport}
              className="mt-1 flex-row items-center justify-center gap-2 rounded-2xl bg-neutral-200 py-3 active:opacity-80 dark:bg-neutral-800">
              <Ionicons name="download-outline" size={18} color={COLORS.brand} />
              <Text className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
                Download report (CSV)
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          onPress={finish}
          className="items-center justify-center rounded-2xl py-4 active:opacity-80"
          style={{ backgroundColor: COLORS.brand }}>
          <Text className="text-base font-semibold text-white">Done</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // -- Error ---------------------------------------------------------------
  if (phase === 'error') {
    return (
      <View className="flex-1 items-center justify-center gap-5 bg-neutral-50 px-8 dark:bg-black">
        <Ionicons name="alert-circle-outline" size={56} color={COLORS.brand} />
        <Text className="text-center text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          Import failed
        </Text>
        <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">
          {errorMsg}
        </Text>
        <Pressable
          onPress={() => setPhase('idle')}
          className="items-center justify-center rounded-2xl px-8 py-3 active:opacity-80"
          style={{ backgroundColor: COLORS.brand }}>
          <Text className="text-base font-semibold text-white">Try again</Text>
        </Pressable>
      </View>
    );
  }

  // -- Idle (intro) --------------------------------------------------------
  return (
    <ScrollView
      className="flex-1 bg-neutral-50 dark:bg-black"
      contentContainerStyle={{ padding: 20, gap: 16 }}>
      <View className="items-center gap-3 pt-4">
        <View
          className="h-16 w-16 items-center justify-center rounded-3xl"
          style={{ backgroundColor: COLORS.brand }}>
          <Ionicons name="cloud-upload-outline" size={32} color="white" />
        </View>
        <Text className="text-center text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          Import data
        </Text>
        <Text className="text-center text-base text-neutral-500 dark:text-neutral-400">
          Select a data export (a .zip file). We&apos;ll import your watched movies and TV episodes,
          match each title to TMDB, and add anything you haven&apos;t started to your watchlist. Titles
          we can&apos;t match are listed at the end.
        </Text>
      </View>

      <View className="gap-2 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
          About the file
        </Text>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">
          It&apos;s a .zip containing your movies and series. You can create one from another device via
          Settings → Export data, then pick that file here.
        </Text>
      </View>

      <Pressable
        onPress={pickAndImport}
        className="flex-row items-center justify-center gap-2 rounded-2xl py-4 active:opacity-80"
        style={{ backgroundColor: COLORS.brand }}>
        <Ionicons name="document-attach-outline" size={20} color="white" />
        <Text className="text-base font-semibold text-white">Choose ZIP file</Text>
      </Pressable>
    </ScrollView>
  );
}
