/**
 * Centralized color constants for the Ollama Orchestrator frontend.
 * Use these constants instead of hardcoded Tailwind color classes.
 *
 * @example
 * // Using Tailwind classes directly (hard to maintain)
 * <div className="bg-gray-800 text-white">
 *
 * // Using centralized constants (easy to update)
 * <div className={`${colors.surface} ${colors.textBase}`}>
 */

export const colors = {
  // Surface colors
  surface: 'bg-surface',
  surfaceRaised: 'bg-surface-raised',
  surfaceBorder: 'border-surface-border',

  // Text colors
  textBase: 'text-text-base',
  textMuted: 'text-text-muted',
  textSubtle: 'text-text-subtle',

  // Semantic colors
  primary: 'bg-primary hover:bg-primary-hover text-text-base',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',

  // Status badges (use semantic tokens where available)
  // Note: Badge component variants use these hardcoded values until semantic tokens exist
  badgeSuccess: 'bg-green-500/20 text-green-400',
  badgeDanger: 'bg-red-500/20 text-red-400',
  badgeWarning: 'bg-yellow-500/20 text-yellow-400',
  badgeInfo: 'bg-blue-500/20 text-blue-400',
  badgeNeutral: 'bg-gray-500/20 text-gray-400',

  // Interaction states
  hoverSurface: 'hover:bg-surface',
  hoverSurfaceRaised: 'hover:bg-surface-raised',
  hoverSurfaceBorder: 'hover:border-surface-border',
} as const;

export const chartColors = {
  blue: '#3B82F6',
  green: '#34D399',
  purple: '#A78BFA',
  pink: '#F472B6',
  yellow: '#FBBF24',
  red: '#EF4444',
  sky: '#60A5FA',
  teal: '#2DD4BF',
  violet: '#8B5CF6',
  fuchsia: '#C026D3',
  orange: '#F97316',
  rose: '#F43F5E',
} as const;

export const CHART_PALETTE = [
  chartColors.blue,
  chartColors.green,
  chartColors.purple,
  chartColors.pink,
  chartColors.yellow,
  chartColors.red,
] as const;

export const logLevelColors = {
  error: '#F2495C',
  warn: '#FF9830',
  info: '#5794F2',
  debug: '#73BF69',
} as const;

export const uiColors = {
  surfaceDark: '#1f2937',
  surfaceBorder: '#374151',
  textLight: '#f3f4f6',
  success: '#22c55e',
  error: '#ef4444',
  info: '#3b82f6',
  warning: '#f59e0b',
  gridLine: '#374151',
  axisLabel: '#9ca3af',
} as const;

export const colorValues = {
  surface: 'var(--color-surface)',
  surfaceRaised: 'var(--color-surface-raised)',
  surfaceBorder: 'var(--color-surface-border)',
  primary: 'var(--color-primary)',
  primaryHover: 'var(--color-primary-hover)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  textBase: 'var(--color-text-base)',
  textMuted: 'var(--color-text-muted)',
  textSubtle: 'var(--color-text-subtle)',
} as const;
