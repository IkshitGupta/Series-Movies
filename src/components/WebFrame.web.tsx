import type { ReactNode } from 'react';
import { View } from 'react-native';

interface WebFrameProps {
  children: ReactNode;
  isDark: boolean;
}

/** Widest the app column grows to on desktop before it stays centered. */
const MAX_WIDTH = 600;

/**
 * Responsive-lite web shell: center the app in a phone-width column against a
 * neutral backdrop so it doesn't stretch full-width on desktop. The bottom tab
 * bar and headers live inside this column. Native uses `WebFrame.tsx`.
 */
export function WebFrame({ children, isDark }: WebFrameProps) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        backgroundColor: isDark ? '#010102' : '#e5e5e5',
      }}>
      <View style={{ flex: 1, width: '100%', maxWidth: MAX_WIDTH }}>{children}</View>
    </View>
  );
}
