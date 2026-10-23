import { useRef } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import type { CastFilter } from '@/store/useLibraryStore';
import { COLORS } from '@/theme/colors';

const CAST_FILTERS: { key: CastFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'movie', label: 'Movies' },
  { key: 'tv', label: 'TV' },
];

const ARROW_STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowDown: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  ArrowUp: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

/** All / Movies / TV scope control for the actor stat. On web it behaves as a
 * WAI-ARIA tablist: one Tab stop, arrows/Home/End move the selection, Space picks. */
export function CastFilterTabs({
  value,
  onChange,
}: {
  value: CastFilter;
  onChange: (filter: CastFilter) => void;
}) {
  const tabRefs = useRef<(View | null)[]>([]);

  // React Native's types don't declare key events; react-native-web supports them.
  const webKeyboardProps = (index: number, active: boolean): object => {
    if (Platform.OS !== 'web') return {};
    return {
      tabIndex: active ? 0 : -1,
      onKeyDown: (e: { key: string; preventDefault: () => void }) => {
        const step = ARROW_STEPS[e.key];
        if (e.key === ' ') {
          e.preventDefault();
          onChange(CAST_FILTERS[index].key);
        } else if (step) {
          e.preventDefault();
          const next = step(index, CAST_FILTERS.length);
          onChange(CAST_FILTERS[next].key);
          tabRefs.current[next]?.focus();
        }
      },
    };
  };

  return (
    <View
      role="tablist"
      className="flex-row gap-1 rounded-2xl bg-neutral-200 p-1 dark:bg-neutral-800">
      {CAST_FILTERS.map((f, index) => {
        const active = value === f.key;
        return (
          <Pressable
            key={f.key}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            onPress={() => onChange(f.key)}
            role="tab"
            aria-selected={active}
            {...webKeyboardProps(index, active)}
            style={{
              flex: 1,
              alignItems: 'center',
              borderRadius: 12,
              paddingVertical: 8,
              backgroundColor: active ? COLORS.white : 'transparent',
            }}>
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: active ? COLORS.brand : COLORS.mutedDark,
              }}>
              {f.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
