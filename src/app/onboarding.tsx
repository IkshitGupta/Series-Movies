import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RedirectToTabs } from '@/components/RedirectToTabs';
import { useLibraryStore } from '@/store/useLibraryStore';
import { COLORS } from '@/theme/colors';

export default function OnboardingScreen() {
  const router = useRouter();
  const onboarded = useLibraryStore((s) => s.onboarded);
  const setOnboarded = useLibraryStore((s) => s.setOnboarded);

  // Never resurface onboarding (e.g. via a back gesture) once it's completed.
  if (onboarded) return <RedirectToTabs />;

  const skip = () => {
    setOnboarded(true);
    router.dismissTo('/(tabs)');
  };

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black">
      <View className="flex-1 justify-center gap-6 px-6">
        <View className="items-center gap-3">
          <Image
            source={require('../../assets/images/logo.png')}
            style={{ width: 80, height: 80, borderRadius: 20 }}
            contentFit="cover"
          />
          <Text className="text-center text-3xl font-bold text-neutral-900 dark:text-neutral-50">
            Welcome to Seen It
          </Text>
          <Text className="text-center text-base text-neutral-500 dark:text-neutral-400">
            Track the movies and shows you watch, and keep a watchlist for later.
          </Text>
        </View>

        <View className="gap-3">
          <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">
            Have a data export from another device? Bring your watch history with you.
          </Text>

          <Pressable
            onPress={() => router.push('/import')}
            className="flex-row items-center justify-center gap-2 rounded-2xl py-4 active:opacity-80"
            style={{ backgroundColor: COLORS.brand }}>
            <Ionicons name="cloud-upload-outline" size={20} color="white" />
            <Text className="text-base font-semibold text-white">Import data</Text>
          </Pressable>

          <Pressable
            onPress={skip}
            className="items-center justify-center rounded-2xl bg-neutral-200 py-4 active:opacity-80 dark:bg-neutral-800">
            <Text className="text-base font-semibold text-neutral-700 dark:text-neutral-200">
              Skip / Start fresh
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
