import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { defaultDir, type SortKey, type SortState } from '@/lib/sort';

const OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'title', label: 'Title' },
  { key: 'year', label: 'Year' },
];

/**
 * Compact sort control: tapping a non-active chip selects it (with its default
 * direction); tapping the active chip flips ascending/descending.
 */
export function SortBar({
  sort,
  onChange,
}: {
  sort: SortState;
  onChange: (next: SortState) => void;
}) {
  const select = (key: SortKey) => {
    if (key === sort.key) {
      onChange({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onChange({ key, dir: defaultDir(key) });
    }
  };

  return (
    <View className="flex-row items-center gap-2">
      <Ionicons name="swap-vertical" size={16} color="#9ca3af" />
      {OPTIONS.map((opt) => {
        const active = opt.key === sort.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => select(opt.key)}
            className="flex-row items-center gap-1 rounded-full border border-neutral-300 px-3 py-1.5 active:opacity-70 dark:border-neutral-700"
            style={active ? { backgroundColor: '#E50914', borderColor: '#E50914' } : undefined}>
            <Text
              className="text-xs font-semibold text-neutral-700 dark:text-neutral-200"
              style={active ? { color: '#ffffff' } : undefined}>
              {opt.label}
            </Text>
            {active ? (
              <Ionicons
                name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'}
                size={12}
                color="#ffffff"
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
