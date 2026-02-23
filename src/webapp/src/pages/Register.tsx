import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router';
import { signUp, confirmSignUp, autoSignIn } from 'aws-amplify/auth';
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
 * Registration page with split layout — branding on left, form on right.
 * Uses Amplify's Cognito `signUp` flow with email confirmation.
 */
export default function Register() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'register' | 'confirm'>('register');
  const [email, setEmail] = useState('');
  const [nameError, setNameError] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  /** Validates inputs and registers a new user via Cognito. */
  const handleRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = (data.get('name') as string).trim();
    const emailVal = (data.get('email') as string).trim();
    const password = data.get('password') as string;
    const confirmPassword = data.get('confirmPassword') as string;

    let valid = true;
    if (!name) {
      setNameError(true);
      valid = false;
    } else {
      setNameError(false);
    }
    if (!emailVal || !/\S+@\S+\.\S+/.test(emailVal)) {
      setEmailError(true);
      valid = false;
    } else {
      setEmailError(false);
    }
    if (!password || password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      valid = false;
    } else if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      valid = false;
    } else {
      setPasswordError('');
    }

    if (!valid) return;

    setError('');
    setLoading(true);

    try {
      const result = await signUp({
        username: emailVal,
        password,
        options: {
          userAttributes: { email: emailVal, name },
          autoSignIn: true,
        },
      });
      setEmail(emailVal);
      if (result.isSignUpComplete) {
        navigate('/', { replace: true });
      } else {
        setStep('confirm');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  /** Confirms email verification code and auto-signs in. */
  const handleConfirm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const code = (data.get('code') as string).trim();

    if (!code || code.length < 6) {
      setCodeError(true);
      return;
    }
    setCodeError(false);
    setError('');
    setLoading(true);

    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      const signInResult = await autoSignIn();
      if (signInResult.isSignedIn) {
        navigate('/', { replace: true });
      } else {
        navigate('/sign-in', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation failed');
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

      {/* Right — Register Card */}
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

            {step === 'register' ? (
              <>
                <Typography variant="h4" sx={{ mb: 3 }}>
                  Create account
                </Typography>
                <Box component="form" onSubmit={handleRegister} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  <FormControl>
                    <FormLabel htmlFor="name">Name</FormLabel>
                    <TextField
                      id="name"
                      name="name"
                      type="text"
                      placeholder="John Doe"
                      autoComplete="name"
                      autoFocus
                      fullWidth
                      size="small"
                      error={nameError}
                      helperText={nameError ? 'Please enter your name' : ''}
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel htmlFor="email">Email</FormLabel>
                    <TextField
                      id="email"
                      name="email"
                      type="email"
                      placeholder="your@email.com"
                      autoComplete="email"
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
                      placeholder="••••••••"
                      autoComplete="new-password"
                      fullWidth
                      size="small"
                      error={!!passwordError}
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
                      error={!!passwordError}
                      helperText={passwordError}
                    />
                  </FormControl>

                  <Button type="submit" variant="contained" size="large" fullWidth disabled={loading} sx={{ mt: 1 }}>
                    {loading ? <CircularProgress size={24} color="inherit" /> : 'Create account'}
                  </Button>
                </Box>

                <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
                  Already have an account?{' '}
                  <Typography component={Link} to="/sign-in" variant="body2" color="primary.main" sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                    Sign in
                  </Typography>
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="h4" sx={{ mb: 1 }}>
                  Confirm your email
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  We sent a verification code to <strong>{email}</strong>. Enter it below to complete registration.
                </Typography>
                <Box component="form" onSubmit={handleConfirm} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  <FormControl>
                    <FormLabel htmlFor="code">Verification code</FormLabel>
                    <TextField
                      id="code"
                      name="code"
                      type="text"
                      placeholder="123456"
                      autoComplete="one-time-code"
                      autoFocus
                      fullWidth
                      size="small"
                      error={codeError}
                      helperText={codeError ? 'Please enter the 6-digit code' : ''}
                    />
                  </FormControl>

                  <Button type="submit" variant="contained" size="large" fullWidth disabled={loading} sx={{ mt: 1 }}>
                    {loading ? <CircularProgress size={24} color="inherit" /> : 'Verify'}
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
