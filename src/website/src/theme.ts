import { createTheme, alpha } from '@mui/material/styles';
import { colors, typography, radii, effects, gradients } from '@shared/styles/tokens';

/**
 * Premium dark marketing theme.
 * Built from shared design tokens — glassmorphism, gradient accents, refined surfaces.
 * Matches the webapp theme for brand consistency.
 */
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: colors.primary.main,
      light: colors.primary.light,
      dark: colors.primary.dark,
      contrastText: colors.primary.contrast,
    },
    secondary: {
      main: colors.secondary.main,
      light: colors.secondary.light,
      dark: colors.secondary.dark,
    },
    success: {
      main: colors.success.main,
      light: colors.success.light,
    },
    error: {
      main: colors.error.main,
      light: colors.error.light,
    },
    warning: {
      main: colors.warning.main,
      light: colors.warning.light,
    },
    background: {
      default: colors.bg.base,
      paper: colors.bg.surface,
    },
    divider: colors.border.default,
    text: {
      primary: colors.text.primary,
      secondary: colors.text.secondary,
    },
  },

  typography: {
    fontFamily: typography.fontFamily.sans,
    h1: {
      fontWeight: typography.fontWeight.bold,
      letterSpacing: typography.letterSpacing.tight,
    },
    h2: {
      fontWeight: typography.fontWeight.bold,
      letterSpacing: typography.letterSpacing.tight,
    },
    h3: {
      fontWeight: typography.fontWeight.bold,
      letterSpacing: typography.letterSpacing.tight,
    },
    h4: {
      fontWeight: typography.fontWeight.bold,
      letterSpacing: typography.letterSpacing.tight,
    },
    h5: {
      fontWeight: typography.fontWeight.semibold,
      letterSpacing: typography.letterSpacing.tight,
    },
    h6: {
      fontWeight: typography.fontWeight.semibold,
    },
    subtitle2: {
      fontWeight: typography.fontWeight.medium,
      color: colors.text.secondary,
    },
    body2: {
      fontSize: '0.8125rem',
    },
    caption: {
      fontSize: '0.75rem',
      color: colors.text.secondary,
    },
  },

  shape: {
    borderRadius: radii.lg,
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage: gradients.glow,
          backgroundAttachment: 'fixed',
        },
      },
    },

    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        root: {
          backgroundImage: gradients.surface,
          backgroundColor: alpha(colors.bg.elevated, 0.6),
          backdropFilter: effects.blur.sm,
          borderColor: colors.border.default,
          transition: effects.transition.normal,
          '&:hover': {
            borderColor: colors.border.strong,
          },
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },

    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: alpha(colors.bg.surface, 0.85),
          backdropFilter: effects.blur.md,
          backgroundImage: 'none',
          borderBottom: `1px solid ${colors.border.subtle}`,
          boxShadow: 'none',
        },
      },
    },

    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: typography.fontWeight.semibold,
          borderRadius: radii.md,
          transition: effects.transition.normal,
        },
        contained: {
          background: gradients.primary,
          boxShadow: effects.shadow.sm,
          '&:hover': {
            background: gradients.primary,
            boxShadow: effects.shadow.glow,
            filter: 'brightness(1.1)',
          },
        },
        outlined: {
          borderColor: colors.border.strong,
          '&:hover': {
            borderColor: colors.primary.main,
            backgroundColor: alpha(colors.primary.main, 0.06),
          },
        },
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: {
          transition: effects.transition.fast,
          '&:hover': {
            backgroundColor: alpha(colors.text.primary, 0.06),
          },
        },
      },
    },

    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: colors.border.subtle,
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: typography.fontWeight.medium,
          borderRadius: radii.sm,
        },
      },
    },
  },
});

export default theme;
