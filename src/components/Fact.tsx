import { Text, View } from 'react-native';

/** A compact "label: value" fact row for detail screens. */
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-2">
      <Text className="w-24 text-xs text-neutral-400 dark:text-neutral-500">{label}</Text>
      <Text className="flex-1 text-xs text-neutral-700 dark:text-neutral-200">{value}</Text>
    </View>
  );
}
