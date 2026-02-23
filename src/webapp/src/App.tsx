import { BrowserRouter, Routes, Route } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './theme';
import AuthGuard from './components/AuthGuard';
import DashboardLayout from './layouts/DashboardLayout';
import SignIn from './pages/SignIn';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Portfolios from './pages/Portfolios';
import Orderbook from './pages/Orderbook';
import Bots from './pages/Bots';
import Settings from './pages/Settings';
import ReleaseNotes from './pages/ReleaseNotes';

/** Root application component with routing and theme. */
export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <AuthGuard>
                <DashboardLayout />
              </AuthGuard>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="portfolios" element={<Portfolios />} />
            <Route path="orderbook" element={<Orderbook />} />
            <Route path="bots" element={<Bots />} />
            <Route path="settings" element={<Settings />} />
            <Route path="release-notes" element={<ReleaseNotes />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
