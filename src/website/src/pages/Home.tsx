import { alpha } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import SpeedIcon from '@mui/icons-material/Speed';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SecurityIcon from '@mui/icons-material/Security';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { gradients, colors, effects } from '@shared/styles/tokens';
/** Base URL for the authenticated webapp (no trailing slash). */
const WEBAPP_URL = import.meta.env.VITE_WEBAPP_URL as string;

/** Feature card data for the highlights section. */
const FEATURES = [
  {
    icon: <AutoGraphIcon sx={{ fontSize: 32 }} />,
    title: 'Visual Rule Builder',
    description: 'Create complex trading strategies with an intuitive drag-and-drop interface. No programming knowledge needed.',
  },
  {
    icon: <ShowChartIcon sx={{ fontSize: 32 }} />,
    title: 'Real-time Market Data',
    description: 'Monitor live orderbooks, price feeds, and market depth across multiple exchanges in one place.',
  },
  {
    icon: <AccountBalanceWalletIcon sx={{ fontSize: 32 }} />,
    title: 'Portfolio Tracking',
    description: 'Track performance across all your exchange accounts with unified dashboards and analytics.',
  },
  {
    icon: <SpeedIcon sx={{ fontSize: 32 }} />,
    title: 'Low-latency Execution',
    description: 'Your bots execute trades with minimal delay, ensuring you never miss an opportunity.',
  },
  {
    icon: <SmartToyIcon sx={{ fontSize: 32 }} />,
    title: 'Smart Bot Management',
    description: 'Deploy, pause, and monitor multiple bots simultaneously with full control over each strategy.',
  },
  {
    icon: <SecurityIcon sx={{ fontSize: 32 }} />,
    title: 'Enterprise-grade Security',
    description: 'API keys are encrypted at rest and in transit. We never have withdrawal permissions on your funds.',
  },
] as const;

/** Metric counter for the social proof section. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography
        variant="h3"
        sx={{
          background: gradients.primary,
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {label}
      </Typography>
    </Box>
  );
}

/**
 * Landing page — hero section, feature highlights, social proof, and CTA.
 */
export default function Home() {
  return (
    <>
      {/* ─── Hero ──────────────────────────────────────────────── */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          pt: { xs: 10, md: 16 },
          pb: { xs: 10, md: 14 },
          background: `
            radial-gradient(ellipse at 20% 50%, rgba(139,92,246,0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 20%, rgba(167,139,250,0.06) 0%, transparent 40%),
            radial-gradient(ellipse at 50% 100%, rgba(76,29,149,0.05) 0%, transparent 50%)
          `,
        }}
      >
        <Container maxWidth="md" sx={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <Typography
            variant="h1"
            sx={{
              fontSize: { xs: '2.5rem', sm: '3.25rem', md: '4rem' },
              lineHeight: 1.15,
              mb: 3,
            }}
          >
            Automate your trading.{' '}
            <Box
              component="span"
              sx={{
                background: gradients.primary,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              No code required.
            </Box>
          </Typography>

          <Typography
            variant="h6"
            color="text.secondary"
            fontWeight={400}
            sx={{ maxWidth: 600, mx: 'auto', mb: 5, lineHeight: 1.6 }}
          >
            Build, test, and deploy automated trading bots with a visual drag-and-drop builder.
            Connect to major exchanges and start trading smarter today.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
            <Button
              variant="contained"
              size="large"
              endIcon={<ArrowForwardIcon />}
              href={`${WEBAPP_URL}/register`}
              sx={{ px: 4, py: 1.5 }}
            >
              Get started free
            </Button>
            <Button
              variant="outlined"
              size="large"
              href="/features"
              sx={{ px: 4, py: 1.5 }}
            >
              See features
            </Button>
          </Stack>
        </Container>
      </Box>

      {/* ─── Social proof ──────────────────────────────────────── */}
      <Box sx={{ py: { xs: 6, md: 8 }, borderBottom: `1px solid ${colors.border.subtle}` }}>
        <Container maxWidth="md">
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 4, sm: 0 }}
            justifyContent="space-around"
            alignItems="center"
          >
            <Stat value="10,000+" label="Active traders" />
            <Stat value="$2.4B" label="Volume traded" />
            <Stat value="99.9%" label="Uptime SLA" />
            <Stat value="50ms" label="Avg. execution" />
          </Stack>
        </Container>
      </Box>

      {/* ─── Feature highlights ────────────────────────────────── */}
      <Box sx={{ py: { xs: 8, md: 12 } }}>
        <Container maxWidth="lg">
          <Box sx={{ textAlign: 'center', mb: { xs: 6, md: 8 } }}>
            <Typography variant="h3" sx={{ fontSize: { xs: '1.75rem', md: '2.25rem' }, mb: 2 }}>
              Everything you need to trade smarter
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 560, mx: 'auto' }}>
              From strategy building to execution monitoring, our platform covers the full trading lifecycle.
            </Typography>
          </Box>

          <Grid container spacing={3}>
            {FEATURES.map((feature) => (
              <Grid key={feature.title} size={{ xs: 12, sm: 6, lg: 4 }}>
                <Card
                  sx={{
                    height: '100%',
                    p: 1,
                    '&:hover': {
                      borderColor: colors.border.strong,
                      boxShadow: effects.shadow.glow,
                    },
                  }}
                >
                  <CardContent>
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: alpha(colors.primary.main, 0.1),
                        color: 'primary.main',
                        mb: 2,
                      }}
                    >
                      {feature.icon}
                    </Box>
                    <Typography variant="h6" sx={{ mb: 1 }}>
                      {feature.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                      {feature.description}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* ─── CTA Banner ────────────────────────────────────────── */}
      <Box sx={{ py: { xs: 8, md: 10 } }}>
        <Container maxWidth="sm" sx={{ textAlign: 'center' }}>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.75rem', md: '2.25rem' }, mb: 2 }}>
            Ready to automate your trading?
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
            Join thousands of traders who have already simplified their workflow with no-code bots.
          </Typography>
          <Button
            variant="contained"
            size="large"
            endIcon={<ArrowForwardIcon />}
            href={`${WEBAPP_URL}/register`}
            sx={{ px: 5, py: 1.5 }}
          >
            Create your free account
          </Button>
        </Container>
      </Box>
    </>
  );
}
