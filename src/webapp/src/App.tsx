import { BrowserRouter, Routes, Route } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './theme';
import AuthGuard from './components/AuthGuard';
import GuestGuard from './components/GuestGuard';
import DashboardLayout from './layouts/DashboardLayout';
import SignIn from './pages/SignIn';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Orderbook from './pages/Orderbook';
import Bots from './pages/Bots';
import BotDetail from './pages/BotDetail';
import BotBacktest from './pages/BotBacktest';
import BotView from './pages/BotView';
import Leaderboard from './pages/Leaderboard';
import TraderProfile from './pages/TraderProfile';
import Settings from './pages/Settings';
import ReleaseNotes from './pages/ReleaseNotes';
import NotFound from './pages/NotFound';

/** Root application component with routing and theme. */
export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<GuestGuard><SignIn /></GuestGuard>} />
          <Route path="/register" element={<GuestGuard><Register /></GuestGuard>} />
          <Route
            path="/"
            element={
              <AuthGuard>
                <DashboardLayout />
              </AuthGuard>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="orderbook" element={<Orderbook />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="leaderboard/:username" element={<TraderProfile />} />
            <Route path="bots" element={<Bots />} />
            <Route path="bots/:pair" element={<BotDetail />} />
            <Route path="bots/view/:botId" element={<BotView />} />
            <Route path="bots/backtest/:botId" element={<BotBacktest />} />
            <Route path="settings" element={<Settings />} />
            <Route path="release-notes" element={<ReleaseNotes />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
