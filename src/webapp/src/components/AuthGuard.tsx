import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { getCurrentUser } from 'aws-amplify/auth';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';

/** Props for {@link AuthGuard}. */
interface AuthGuardProps {
  children: ReactNode;
}

/**
 * Protects child routes by checking Cognito auth state.
 * Redirects unauthenticated users to `/sign-in`.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then(() => setChecking(false))
      .catch(() => void navigate('/sign-in', { replace: true }));
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
