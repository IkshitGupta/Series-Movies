import { type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';

import { COLORS } from '@/theme/colors';

type ChipVariant = 'outline' | 'filled';
type ChipSize = 'sm' | 'md';

/** Inactive container styling per variant (active = brand fill, handled inline). */
const CONTAINER: Record<ChipVariant, string> = {
  outline: 'border border-neutral-300 dark:border-neutral-700',
  filled: 'bg-neutral-200 dark:bg-neutral-800',
};

const PADDING: Record<ChipSize, string> = {
  sm: 'px-3 py-1.5',
  md: 'px-4 py-2',
};

const TEXT_SIZE: Record<ChipSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
};

/**
 * On Android, a `Text` inside a horizontal `ScrollView` gets its line box capped
 * (clipping descenders) and the default line-height dropped. `scrollFix` restores
 * room with an explicit `lineHeight` and re-centers the glyph (Android adds the
 * extra leading above the text) with a small `translateY`. Only pass it for chips
 * rendered inside a horizontal ScrollView — elsewhere the natural layout already
 * centers correctly, so applying it would push the text too high.
 */
const SCROLL_FIX: Record<ChipSize, { lineHeight: number; translateY: number }> = {
  sm: { lineHeight: 24, translateY: -4 },
  md: { lineHeight: 28, translateY: -5 },
};

export interface SelectChipProps {
  label: string;
  /** Selected state — brand fill + white text. */
  active?: boolean;
  /** Inactive look: bordered (`outline`) or soft-filled (`filled`). */
  variant?: ChipVariant;
  size?: ChipSize;
  onPress?: () => void;
  /** Optional trailing node (e.g. a sort-direction arrow). */
  trailing?: ReactNode;
  /** Apply the Android horizontal-ScrollView vertical-centering fix (see note). */
  scrollFix?: boolean;
}

/**
 * A selectable pill used for segmented filters and sort/status controls.
 * Consolidates the SortBar, Series filter, show status, and season-selector chips.
 */
export function SelectChip({
  label,
  active = false,
  variant = 'outline',
  size = 'sm',
  onPress,
  trailing,
  scrollFix = false,
}: SelectChipProps) {
  const fix = scrollFix ? SCROLL_FIX[size] : null;
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-1 self-center rounded-full ${PADDING[size]} active:opacity-80 ${
        active ? '' : CONTAINER[variant]
      }`}
      style={active ? { backgroundColor: COLORS.brand, borderColor: COLORS.brand } : undefined}>
      <Text
        className={`${TEXT_SIZE[size]} font-semibold ${
          active ? '' : 'text-neutral-700 dark:text-neutral-200'
        }`}
        style={[
          fix
            ? {
                lineHeight: fix.lineHeight,
                includeFontPadding: false,
                textAlignVertical: 'center',
                transform: [{ translateY: fix.translateY }],
              }
            : null,
          active ? { color: COLORS.white } : null,
        ]}>
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}
