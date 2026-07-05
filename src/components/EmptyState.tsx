import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps } from 'react';
import { Text, View } from 'react-native';

interface EmptyStateProps {
  icon?: ComponentProps<typeof Ionicons>['name'];
  title: string;
  message?: string;
}

export function EmptyState({ icon = 'film-outline', title, message }: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8 py-16">
      <Ionicons name={icon} size={48} color="#9ca3af" />
      <Text className="text-center text-lg font-semibold text-neutral-800 dark:text-neutral-100">
        {title}
      </Text>
      {message ? (
        <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
