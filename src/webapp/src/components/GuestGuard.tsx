import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { getCurrentUser } from 'aws-amplify/auth';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';

/** Props for {@link GuestGuard}. */
interface GuestGuardProps {
  children: ReactNode;
}

/**
 * Protects guest-only routes (sign-in, register) by checking Cognito auth state.
 * Redirects authenticated users to the dashboard.
 */
export default function GuestGuard({ children }: GuestGuardProps) {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then(() => void navigate('/', { replace: true }))
      .catch(() => setChecking(false));
  }, [navigate]);

  if (checking) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  return <>{children}</>;
}
