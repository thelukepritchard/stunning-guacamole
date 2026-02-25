import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import { gradients, colors } from '@shared/styles/tokens';
/** Base URL for the authenticated webapp (no trailing slash). */
const WEBAPP_URL = import.meta.env.VITE_WEBAPP_URL as string;

/** Navigation links shown in the header. */
const NAV_LINKS = [
  { label: 'Features', path: '/features' },
  { label: 'Pricing', path: '/pricing' },
] as const;

/**
 * Marketing site shell — sticky navbar + footer.
 * Content is rendered via `<Outlet />`.
 */
export default function MarketingLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* ─── Navbar ────────────────────────────────────────────── */}
      <AppBar position="sticky" elevation={0}>
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ height: 70 }}>
            {/* Logo */}
            <Typography
              variant="h6"
              onClick={() => navigate('/')}
              sx={{
                cursor: 'pointer',
                fontWeight: 700,
                background: gradients.primary,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                mr: 4,
              }}
            >
              Signalr
            </Typography>

            {/* Desktop nav links */}
            <Stack direction="row" spacing={1} sx={{ display: { xs: 'none', md: 'flex' }, flex: 1 }}>
              {NAV_LINKS.map((link) => (
                <Button
                  key={link.path}
                  onClick={() => navigate(link.path)}
                  sx={{
                    color: location.pathname === link.path ? 'primary.main' : 'text.secondary',
                    fontWeight: location.pathname === link.path ? 600 : 400,
                    '&:hover': { color: 'primary.light' },
                  }}
                >
                  {link.label}
                </Button>
              ))}
            </Stack>

            {/* Desktop CTA */}
            <Stack direction="row" spacing={1.5} sx={{ display: { xs: 'none', md: 'flex' } }}>
              <Button variant="outlined" size="small" href={`${WEBAPP_URL}/sign-in`}>
                Sign in
              </Button>
              <Button variant="contained" size="small" href={`${WEBAPP_URL}/register`}>
                Get started
              </Button>
            </Stack>

            {/* Mobile hamburger */}
            <Box sx={{ display: { xs: 'flex', md: 'none' }, ml: 'auto' }}>
              <IconButton color="inherit" onClick={() => setMobileOpen(true)}>
                <MenuIcon />
              </IconButton>
            </Box>
          </Toolbar>
        </Container>
      </AppBar>

      {/* ─── Mobile drawer ─────────────────────────────────────── */}
      <Drawer
        anchor="right"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ '& .MuiDrawer-paper': { width: 280, backgroundColor: colors.bg.surface } }}
      >
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <IconButton onClick={() => setMobileOpen(false)}>
            <CloseIcon />
          </IconButton>
        </Box>
        <List>
          {NAV_LINKS.map((link) => (
            <ListItemButton
              key={link.path}
              selected={location.pathname === link.path}
              onClick={() => {
                navigate(link.path);
                setMobileOpen(false);
              }}
            >
              <ListItemText primary={link.label} />
            </ListItemButton>
          ))}
        </List>
        <Stack spacing={1.5} sx={{ p: 2 }}>
          <Button variant="outlined" fullWidth href={`${WEBAPP_URL}/sign-in`}>
            Sign in
          </Button>
          <Button variant="contained" fullWidth href={`${WEBAPP_URL}/register`}>
            Get started
          </Button>
        </Stack>
      </Drawer>

      {/* ─── Page content ──────────────────────────────────────── */}
      <Box component="main" sx={{ flex: 1 }}>
        <Outlet />
      </Box>

      {/* ─── Footer ────────────────────────────────────────────── */}
      <Box component="footer" sx={{ borderTop: `1px solid ${colors.border.subtle}`, mt: 'auto' }}>
        <Container maxWidth="lg" sx={{ py: 6 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'center' }}
            spacing={4}
          >
            {/* Brand */}
            <Box>
              <Typography
                variant="h6"
                fontWeight={700}
                sx={{
                  background: gradients.primary,
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  mb: 1,
                }}
              >
                Signalr
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
                Automated trading strategies for everyone. No code required.
              </Typography>
            </Box>

            {/* Links */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 2, sm: 6 }}>
              <Box>
                <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1, display: 'block' }}>
                  Product
                </Typography>
                <Stack spacing={0.5}>
                  <Typography variant="body2" color="text.secondary" sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }} onClick={() => navigate('/features')}>
                    Features
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }} onClick={() => navigate('/pricing')}>
                    Pricing
                  </Typography>
                </Stack>
              </Box>
              <Box>
                <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1, display: 'block' }}>
                  Account
                </Typography>
                <Stack spacing={0.5}>
                  <Typography variant="body2" color="text.secondary" component="a" href={`${WEBAPP_URL}/sign-in`} sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { color: 'primary.main' } }}>
                    Sign in
                  </Typography>
                  <Typography variant="body2" color="text.secondary" component="a" href={`${WEBAPP_URL}/register`} sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { color: 'primary.main' } }}>
                    Register
                  </Typography>
                </Stack>
              </Box>
            </Stack>
          </Stack>

          <Divider sx={{ my: 4 }} />

          <Typography variant="caption" color="text.tertiary">
            &copy; {new Date().getFullYear()} Signalr. All rights reserved.
          </Typography>
        </Container>
      </Box>
    </Box>
  );
}
