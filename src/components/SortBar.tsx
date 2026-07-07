import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { SelectChip } from '@/components/SelectChip';
import { defaultDir, type SortKey, type SortState } from '@/lib/sort';
import { COLORS } from '@/theme/colors';

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
      <Ionicons name="swap-vertical" size={16} color={COLORS.muted} />
      {OPTIONS.map((opt) => {
        const active = opt.key === sort.key;
        return (
          <SelectChip
            key={opt.key}
            label={opt.label}
            active={active}
            onPress={() => select(opt.key)}
            trailing={
              active ? (
                <Ionicons
                  name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'}
                  size={12}
                  color={COLORS.white}
                />
              ) : null
            }
          />
        );
      })}
    </View>
  );
}
