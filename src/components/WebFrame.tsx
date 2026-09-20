import type { ReactNode } from 'react';

interface WebFrameProps {
  children: ReactNode;
  isDark: boolean;
}

/**
 * Native passthrough. The centered, max-width web layout lives in
 * `WebFrame.web.tsx`, which Metro resolves for the web platform.
 */
export function WebFrame({ children }: WebFrameProps) {
  return <>{children}</>;
}
