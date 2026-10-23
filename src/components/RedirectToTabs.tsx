import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';

/**
 * Like `<Redirect href="/(tabs)" />`, but goes back to the tabs when they're
 * already underneath (a reload or deep link puts them below the opened screen)
 * instead of stacking a second copy of the tabs on top.
 */
export function RedirectToTabs() {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      router.dismissTo('/(tabs)');
    }, [router]),
  );
  return null;
}
