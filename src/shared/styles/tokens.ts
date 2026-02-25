/**
 * Design tokens for the Signalr platform.
 * Framework-agnostic — consumed by MUI theme (webapp) and CSS variables (website).
 */

/* ─── Colour palette ──────────────────────────────────────────────── */

export const colors = {
  /** Background scale — deep navy with blue undertones */
  bg: {
    base: '#060a13',
    surface: '#0b1121',
    elevated: '#101829',
    hover: '#151f33',
    overlay: 'rgba(6, 10, 19, 0.85)',
  },

  /** Primary — vibrant purple */
  primary: {
    main: '#8b5cf6',
    light: '#a78bfa',
    dark: '#6d28d9',
    contrast: '#060a13',
  },

  /** Secondary — soft violet */
  secondary: {
    main: '#a78bfa',
    light: '#c4b5fd',
    dark: '#7c3aed',
  },

  /** Semantic */
  success: { main: '#34d399', light: '#6ee7b7' },
  error: { main: '#f87171', light: '#fca5a5' },
  warning: { main: '#fbbf24', light: '#fde68a' },

  /** Text */
  text: {
    primary: '#e2e8f0',
    secondary: '#64748b',
    tertiary: '#475569',
  },

  /** Borders */
  border: {
    subtle: 'rgba(255, 255, 255, 0.05)',
    default: 'rgba(255, 255, 255, 0.08)',
    strong: 'rgba(255, 255, 255, 0.14)',
    focus: 'rgba(139, 92, 246, 0.4)',
  },
} as const;

/* ─── Gradients ───────────────────────────────────────────────────── */

export const gradients = {
  primary: 'linear-gradient(135deg, #8b5cf6 0%, #4c1d95 100%)',
  accent: 'linear-gradient(135deg, #a78bfa 0%, #6366f1 100%)',
  surface: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%)',
  glow: 'radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.08) 0%, transparent 60%)',
} as const;

/* ─── Typography ──────────────────────────────────────────────────── */

export const typography = {
  fontFamily: {
    sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "SF Mono", Monaco, monospace',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  letterSpacing: {
    tight: '-0.02em',
    normal: '0',
    wide: '0.05em',
    wider: '0.08em',
  },
} as const;

/* ─── Shape ───────────────────────────────────────────────────────── */

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
} as const;

/* ─── Effects ─────────────────────────────────────────────────────── */

export const effects = {
  blur: {
    sm: 'blur(8px)',
    md: 'blur(16px)',
    lg: 'blur(24px)',
  },
  shadow: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
    md: '0 4px 12px rgba(0, 0, 0, 0.4)',
    lg: '0 8px 24px rgba(0, 0, 0, 0.5)',
    glow: '0 0 20px rgba(139, 92, 246, 0.15)',
  },
  transition: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    normal: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
} as const;
