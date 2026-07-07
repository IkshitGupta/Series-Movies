import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps } from 'react';
import { Text, View } from 'react-native';

import { COLORS } from '@/theme/colors';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * A small, non-interactive descriptive pill (genre, network, …). For selectable
 * chips use {@link SelectChip}; for the colored Movie/TV marker use StatusBadge.
 */
export function Tag({ label, icon }: { label: string; icon?: IoniconName }) {
  return (
    <View className="flex-row items-center gap-1 self-start rounded-full bg-neutral-200 px-2 py-0.5 dark:bg-neutral-800">
      {icon ? <Ionicons name={icon} size={11} color={COLORS.muted} /> : null}
      <Text className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">{label}</Text>
    </View>
  );
}
