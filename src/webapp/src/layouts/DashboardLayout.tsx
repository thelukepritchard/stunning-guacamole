import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router';
import { signOut, fetchUserAttributes } from 'aws-amplify/auth';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import FeedbackOutlinedIcon from '@mui/icons-material/FeedbackOutlined';
import NewReleasesOutlinedIcon from '@mui/icons-material/NewReleasesOutlined';
import FeedbackDialog from '../components/FeedbackDialog';

const DRAWER_WIDTH = 260;

/** Navigation items for the sidebar. */
const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: <DashboardOutlinedIcon /> },
  { label: 'Portfolios', path: '/portfolios', icon: <AccountBalanceWalletOutlinedIcon /> },
  { label: 'Orderbook', path: '/orderbook', icon: <MenuBookOutlinedIcon /> },
  { label: 'Bots', path: '/bots', icon: <SmartToyOutlinedIcon /> },
] as const;

/**
 * App shell layout with permanent sidebar on desktop and temporary drawer on mobile.
 * No top AppBar on desktop — matches the MUI dashboard template pattern.
 */
export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    fetchUserAttributes()
      .then((attrs) => {
        setEmail(attrs.email ?? '');
        const fullName = [attrs.given_name, attrs.family_name].filter(Boolean).join(' ');
        setName(fullName || attrs.email?.split('@')[0] || '');
      })
      .catch(() => {});
  }, []);

  /** Handles user sign-out and redirects to sign-in page. */
  const handleSignOut = async () => {
    await signOut();
    navigate('/sign-in', { replace: true });
  };

  const sidebarContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* App Title */}
      <Box sx={{ px: 2.5, py: 2.5 }}>
        <Typography variant="h6" fontWeight={700}>
          Bot Trading
        </Typography>
      </Box>
      <Divider />

      {/* Navigation */}
      <List dense sx={{ flex: 1, pt: 1 }}>
        {NAV_ITEMS.map((item) => (
          <ListItemButton
            key={item.path}
            selected={location.pathname === item.path}
            onClick={() => {
              navigate(item.path);
              setMobileOpen(false);
            }}
            sx={{ my: 0.5 }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>

      {/* Settings, Feedback & Release Notes */}
      <List dense>
        <ListItemButton
          selected={location.pathname === '/settings'}
          onClick={() => {
            navigate('/settings');
            setMobileOpen(false);
          }}
          sx={{ my: 0.5, py: 0.5 }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}><SettingsOutlinedIcon sx={{ fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="Settings" primaryTypographyProps={{ variant: 'body2' }} />
        </ListItemButton>
        <ListItemButton
          onClick={() => {
            setFeedbackOpen(true);
            setMobileOpen(false);
          }}
          sx={{ my: 0.5, py: 0.5 }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}><FeedbackOutlinedIcon sx={{ fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="Feedback" primaryTypographyProps={{ variant: 'body2' }} />
        </ListItemButton>
        <ListItemButton
          selected={location.pathname === '/release-notes'}
          onClick={() => {
            navigate('/release-notes');
            setMobileOpen(false);
          }}
          sx={{ my: 0.5, py: 0.5 }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}><NewReleasesOutlinedIcon sx={{ fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="Release Notes" primaryTypographyProps={{ variant: 'body2' }} />
        </ListItemButton>
      </List>

      {/* User Section */}
      <Divider />
      <Box sx={{ p: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Avatar sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: 14 }}>
            {email ? email[0]!.toUpperCase() : '?'}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {name || 'Loading\u2026'}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {email}
            </Typography>
          </Box>
          <IconButton size="small" onClick={handleSignOut} title="Sign out">
            <LogoutOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      {/* Mobile AppBar — only visible on small screens */}
      <AppBar
        position="fixed"
        sx={{
          display: { md: 'none' },
          zIndex: (t) => t.zIndex.drawer + 1,
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setMobileOpen(!mobileOpen)}
            sx={{ mr: 2 }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            Bot Trading
          </Typography>
          <Button color="inherit" onClick={handleSignOut} size="small">
            Sign out
          </Button>
        </Toolbar>
      </AppBar>

      {/* Mobile drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },
        }}
      >
        {sidebarContent}
      </Drawer>

      {/* Desktop drawer — permanent */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },
        }}
        open
      >
        {sidebarContent}
      </Drawer>

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          minHeight: '100vh',
        }}
      >
        {/* Spacer for mobile AppBar */}
        <Toolbar sx={{ display: { md: 'none' } }} />
        <Stack
          sx={{
            maxWidth: 1700,
            mx: 'auto',
            p: { xs: 2, sm: 3 },
          }}
        >
          <Outlet />
        </Stack>
      </Box>
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </Box>
  );
}
