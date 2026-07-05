import { Text, View } from 'react-native';

type BadgeTone = 'neutral' | 'brand' | 'success' | 'info';

interface StatusBadgeProps {
  label: string;
  tone?: BadgeTone;
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-200 dark:bg-neutral-700',
  brand: 'bg-brand',
  success: 'bg-green-600',
  info: 'bg-blue-600',
};

const TEXT_TONES: Record<BadgeTone, string> = {
  neutral: 'text-neutral-700 dark:text-neutral-200',
  brand: 'text-white',
  success: 'text-white',
  info: 'text-white',
};

export function StatusBadge({ label, tone = 'neutral' }: StatusBadgeProps) {
  return (
    <View className={`self-start rounded-full px-2 py-0.5 ${TONES[tone]}`}>
      <Text className={`text-[11px] font-semibold ${TEXT_TONES[tone]}`}>{label}</Text>
    </View>
  );
}
