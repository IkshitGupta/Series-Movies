import { Text, View } from 'react-native';

/** Age-rating / content-rating badge (e.g. "PG-13", "TV-MA") for detail headers. */
export function CertBadge({ value }: { value: string }) {
  return (
    <View className="rounded border border-neutral-400 px-1 dark:border-neutral-600">
      <Text className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400">
        {value}
      </Text>
    </View>
  );
}
