import { createTheme, alpha } from '@mui/material/styles';

/** Dark trading theme with blue primary and Inter font. */
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      light: '#64b5f6',
      main: '#2196f3',
      dark: '#1565c0',
    },
    secondary: {
      main: '#ce93d8',
    },
    success: {
      main: '#66bb6a',
      light: '#81c784',
    },
    error: {
      main: '#f44336',
      light: '#e57373',
    },
    background: {
      default: '#0a0e17',
      paper: '#111827',
    },
    divider: alpha('#ffffff', 0.08),
    text: {
      primary: '#f1f5f9',
      secondary: '#94a3b8',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    subtitle2: { fontWeight: 500, color: '#94a3b8' },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderColor: alpha('#ffffff', 0.08),
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#111827',
          borderRight: `1px solid ${alpha('#ffffff', 0.08)}`,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#111827',
          backgroundImage: 'none',
          borderBottom: `1px solid ${alpha('#ffffff', 0.08)}`,
          boxShadow: 'none',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 600,
          textTransform: 'uppercase',
          fontSize: '0.75rem',
          letterSpacing: '0.05em',
          color: '#94a3b8',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          marginInline: 8,
          '&.Mui-selected': {
            backgroundColor: alpha('#2196f3', 0.12),
            '&:hover': {
              backgroundColor: alpha('#2196f3', 0.18),
            },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
  },
});

export default theme;
