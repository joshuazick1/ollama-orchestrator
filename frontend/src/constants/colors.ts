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

// For inline styles that need actual color values (not class names)
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