import { View } from 'react-native';

interface ProgressBarProps {
  /** 0..1 */
  value: number;
  className?: string;
}

export function ProgressBar({ value, className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View
      className={`h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700 ${className ?? ''}`}>
      <View className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
    </View>
  );
}
