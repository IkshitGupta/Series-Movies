/**
 * Central color tokens (JS source of truth).
 *
 * Use these for props that can't take a Tailwind class — `Ionicons` `color=`,
 * `ActivityIndicator` `color=`, `TextInput` `placeholderTextColor=`, and inline
 * `style` colors. For `className` usage keep the Tailwind tokens (`bg-brand`,
 * `text-brand`, …).
 *
 * NOTE: `brand` mirrors the `brand.DEFAULT` value in `tailwind.config.js`
 * (`#E50914`) — keep the two in sync if either changes.
 */
export const COLORS = {
  /** Primary brand red (Tailwind `brand.DEFAULT`). */
  brand: '#E50914',
  /** Darker brand red for pressed/hover accents (Tailwind `brand.dark`). */
  brandDark: '#B20710',
  /** Brand red at ~12% alpha — soft icon/badge backgrounds. */
  brandTint: '#E5091420',

  white: '#ffffff',

  /** neutral-400 — icons, placeholders, secondary glyphs. */
  muted: '#9ca3af',
  /** neutral-500 — inactive segmented-control text. */
  mutedDark: '#6b7280',

  /** green-600 — "watched" affordances. */
  success: '#16a34a',
  /** Star-rating gold. */
  gold: '#f5c518',
} as const;

export type ColorToken = keyof typeof COLORS;
