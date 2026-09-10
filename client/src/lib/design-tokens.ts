/**
 * Cortardo Design System — Token Source of Truth
 *
 * These tokens mirror the CSS custom properties in index.css and
 * Tailwind config. Prefer Tailwind / utility classes over inline style.
 * This file exists for the rare inline-style case and for JS-only consumers.
 */

export const colors = {
  // Brand
  brand: '#284B63',
  brandForeground: '#FFFFFF',
  brandMuted: 'hsl(204 42% 27% / 0.1)',
  brandBorder: 'hsl(204 42% 27% / 0.25)',
  brandHover: 'hsl(204 42% 20%)',

  // Blue accent
  blue: '#284B63',
  blueMuted: 'hsl(204 42% 27% / 0.1)',
  blueBorder: 'hsl(204 30% 78%)',
  blueHover: 'hsl(204 42% 38%)',

  // Ink
  foreground: '#1E1E1E',
  foregroundStrong: '#1E1E1E',
  foregroundMuted: '#6B6F76',
  foregroundSecondary: '#86868b',
  foregroundSubtle: '#8A8F98',
  foregroundFaint: '#C3C6CC',

  // Surfaces
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#FAFAFA',
  surfaceSubtle: '#F5F7FA',
  surfaceHover: 'hsl(220 14% 96%)',
  surfaceActive: 'hsl(219 50% 97%)',

  // Borders
  border: 'hsl(220 14% 91%)',
  borderSubtle: 'hsl(45 8% 94%)',
  borderStrong: 'hsl(220 14% 86%)',

  // Primary
  primary: '#284B63',
  primaryForeground: '#FFFFFF',
  primaryHover: 'hsl(204 42% 27% / 0.92)',

  // Semantic
  success: '#1F9D69',
  successMuted: 'hsl(152 60% 40% / 0.1)',
  warning: '#E78A13',
  warningMuted: 'hsl(32 92% 48% / 0.12)',
  danger: '#DC2B2B',
  dangerMuted: 'hsl(0 72% 51% / 0.08)',
  info: '#284B63',
  infoMuted: 'hsl(204 42% 27% / 0.1)',

  // Legacy aliases (kept for gradual migration)
  secondary: '#6B6F76',
  muted: '#6B6F76',
  mutedLight: '#8A8F98',
  borderLight: 'hsl(220 14% 95%)',
  borderHover: 'hsl(220 14% 88%)',
  hover: 'hsl(220 14% 96%)',
  error: '#DC2B2B',
  errorLight: 'hsl(0 72% 51% / 0.1)',
  successLight: 'hsl(152 60% 40% / 0.12)',
  warningLight: 'hsl(32 92% 48% / 0.12)',
  infoLight: 'hsl(204 42% 27% / 0.1)',
  foregroundOnPrimary: '#FFFFFF',
} as const;

export const typography = {
  fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
  fontMono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",

  /* Marketing scale */
  display: { fontSize: 52, fontWeight: 500, lineHeight: 1.05, letterSpacing: '-0.03em', color: colors.foreground },
  h1:      { fontSize: 40, fontWeight: 500, lineHeight: 1.08, letterSpacing: '-0.03em', color: colors.foreground },
  h2:      { fontSize: 28, fontWeight: 500, lineHeight: 1.15, letterSpacing: '-0.025em', color: colors.foreground },

  /* App scale */
  h3:         { fontSize: 21, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.015em', color: colors.foreground },
  h4:         { fontSize: 15, fontWeight: 600, lineHeight: 1.3,  letterSpacing: '-0.01em',  color: colors.foreground },
  pageTitle:  { fontSize: 21, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.015em', color: colors.foreground },
  sectionTitle: { fontSize: 15, fontWeight: 500, lineHeight: 1.3,  letterSpacing: '-0.01em',  color: colors.foreground },

  /* Body */
  body:      { fontSize: 13.5, fontWeight: 500, lineHeight: 1.65, color: colors.foregroundMuted },
  bodySmall: { fontSize: 12.5, fontWeight: 500, lineHeight: 1.6,  color: colors.foregroundMuted },
  caption:   { fontSize: 12,   fontWeight: 500, lineHeight: 1.5,  color: colors.foregroundSubtle },

  label:     { fontSize: 12, fontWeight: 600, lineHeight: 1.4, letterSpacing: '0.005em', color: colors.foreground },
  labelCaps: { fontSize: 11, fontWeight: 700, lineHeight: 1.4, letterSpacing: '0.1em',
               textTransform: 'uppercase' as const, color: colors.brand },

  button:      { fontSize: 14,   fontWeight: 500, lineHeight: 1 },
  buttonSmall: { fontSize: 12.5, fontWeight: 500, lineHeight: 1 },
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20,
  '2xl': 24, '3xl': 32, '4xl': 40, '5xl': 48, '6xl': 64, '8xl': 96,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  '2xl': 14,
  full: 9999,
} as const;

/** Legacy alias */
export const borderRadius = radius;

export const shadows = {
  none: 'none',
  focus: '0 0 0 3px hsl(204 42% 27% / 0.18)',
} as const;

export const transitions = {
  fast:   '0.12s ease',
  normal: '0.15s ease',
  slow:   '0.22s ease-out',
  spring: '0.22s cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

/** Sidebar layout tokens (preserved, unchanged). */
export const sidebar = {
  width: 260,
  sectionGap: 14,
  itemHeight: 30,
  itemGap: 2,
  itemPaddingX: 8,
  itemBorderRadius: 10,
  sectionLabelHeight: 22,
  mobileHeaderHeight: 48,
} as const;

export const header = {
  height: 56,
} as const;

export const pageContent = {
  maxWidth: '1060px',
  maxWidthNarrow: '720px',
  paddingX: 24,
} as const;
