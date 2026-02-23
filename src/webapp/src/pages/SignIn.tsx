import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router';
import { signIn, confirmSignIn } from 'aws-amplify/auth';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import SpeedIcon from '@mui/icons-material/Speed';

/** Feature bullet for the left content panel. */
function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Box sx={{ color: 'primary.main' }}>{icon}</Box>
      <Typography variant="body1" color="text.secondary">
        {text}
      </Typography>
    </Stack>
  );
}

/**
 * Sign-in page with split layout — branding on left, form on right.
 * Uses Amplify's Cognito `signIn` flow.
 */
export default function SignIn() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'sign-in' | 'new-password'>('sign-in');
  const [emailError, setEmailError] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [newPasswordError, setNewPasswordError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  /** Validates inputs and signs in via Cognito. */
  const handleSignIn = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = data.get('email') as string;
    const password = data.get('password') as string;

    let valid = true;
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setEmailError(true);
      valid = false;
    } else {
      setEmailError(false);
    }
    if (!password || password.length < 6) {
      setPasswordError(true);
      valid = false;
    } else {
      setPasswordError(false);
    }

    if (!valid) return;

    setError('');
    setLoading(true);

    try {
      const result = await signIn({ username: email, password });
      if (result.isSignedIn) {
        navigate('/', { replace: true });
      } else if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setStep('new-password');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  /** Handles the forced password reset for admin-created users. */
  const handleNewPassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const newPassword = data.get('newPassword') as string;
    const confirmPassword = data.get('confirmPassword') as string;

    if (!newPassword || newPassword.length < 8) {
      setNewPasswordError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setNewPasswordError('Passwords do not match');
      return;
    }

    setNewPasswordError('');
    setError('');
    setLoading(true);

    try {
      const result = await confirmSignIn({ challengeResponse: newPassword });
      if (result.isSignedIn) {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at 50% 50%, rgba(33,150,243,0.08) 0%, transparent 60%)',
      }}
    >
      {/* Left — Branding Content */}
      <Box
        sx={{
          flex: 1,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-end',
          px: 8,
          gap: 4,
        }}
      >
        <Box sx={{ maxWidth: 480 }}>
        <Typography variant="h3" fontWeight={700}>
          No-code Bot Trading
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 2 }}>
          Build, test, and deploy automated trading strategies without writing a single line of code.
        </Typography>
        <Stack spacing={3} sx={{ mt: 3 }}>
          <Feature icon={<AutoGraphIcon />} text="Drag-and-drop rule builder for trading bots" />
          <Feature icon={<ShowChartIcon />} text="Real-time orderbook and market data" />
          <Feature icon={<AccountBalanceWalletIcon />} text="Multi-exchange portfolio tracking" />
          <Feature icon={<SpeedIcon />} text="Automated execution with low latency" />
        </Stack>
        </Box>
      </Box>

      {/* Right — Sign In Card */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: { xs: 'center', md: 'flex-start' },
          px: { xs: 3, md: 8 },
        }}
      >
        <Card sx={{ width: '100%', maxWidth: 450 }}>
          <CardContent sx={{ p: 4 }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {step === 'sign-in' ? (
              <>
                <Typography variant="h4" sx={{ mb: 3 }}>
                  Sign in
                </Typography>
                <Box component="form" onSubmit={handleSignIn} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  <FormControl>
                    <FormLabel htmlFor="email">Email</FormLabel>
                    <TextField
                      id="email"
                      name="email"
                      type="email"
                      placeholder="your@email.com"
                      autoComplete="email"
                      autoFocus
                      fullWidth
                      size="small"
                      error={emailError}
                      helperText={emailError ? 'Please enter a valid email address' : ''}
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel htmlFor="password">Password</FormLabel>
                    <TextField
                      id="password"
                      name="password"
                      type="password"
                      placeholder="••••••"
                      autoComplete="current-password"
                      fullWidth
                      size="small"
                      error={passwordError}
                      helperText={passwordError ? 'Password must be at least 6 characters' : ''}
                    />
                  </FormControl>

                  <Button type="submit" variant="contained" size="large" fullWidth disabled={loading} sx={{ mt: 1 }}>
                    {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign in'}
                  </Button>
                </Box>

                <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
                  Don&apos;t have an account?{' '}
                  <Typography component={Link} to="/register" variant="body2" color="primary.main" sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                    Register
                  </Typography>
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="h4" sx={{ mb: 1 }}>
                  Set new password
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Your account requires a new password before you can continue.
                </Typography>
                <Box component="form" onSubmit={handleNewPassword} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  <FormControl>
                    <FormLabel htmlFor="newPassword">New password</FormLabel>
                    <TextField
                      id="newPassword"
                      name="newPassword"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      autoFocus
                      fullWidth
                      size="small"
                      error={!!newPasswordError}
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel htmlFor="confirmPassword">Confirm password</FormLabel>
                    <TextField
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      fullWidth
                      size="small"
                      error={!!newPasswordError}
                      helperText={newPasswordError}
                    />
                  </FormControl>

                  <Button type="submit" variant="contained" size="large" fullWidth disabled={loading} sx={{ mt: 1 }}>
                    {loading ? <CircularProgress size={24} color="inherit" /> : 'Set password'}
                  </Button>
                </Box>
              </>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
