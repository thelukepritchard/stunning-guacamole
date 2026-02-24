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
import TuneIcon from '@mui/icons-material/Tune';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import BarChartIcon from '@mui/icons-material/BarChart';
import IntegrationInstructionsIcon from '@mui/icons-material/IntegrationInstructions';
import HistoryIcon from '@mui/icons-material/History';
import DevicesIcon from '@mui/icons-material/Devices';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { gradients, colors, effects } from '@shared/styles/tokens';
/** Base URL for the authenticated webapp (no trailing slash). */
const WEBAPP_URL = import.meta.env.VITE_WEBAPP_URL as string;

/** Full feature set with categories. */
const FEATURE_SECTIONS = [
  {
    category: 'Strategy Building',
    items: [
      {
        icon: <AutoGraphIcon sx={{ fontSize: 28 }} />,
        title: 'Drag-and-drop Rule Builder',
        description: 'Construct trading logic visually using conditions, indicators, and actions. Group rules with AND/OR operators to create sophisticated strategies.',
      },
      {
        icon: <TuneIcon sx={{ fontSize: 28 }} />,
        title: 'Custom Parameters',
        description: 'Fine-tune every aspect of your strategy with configurable parameters like thresholds, timeframes, and position sizes.',
      },
      {
        icon: <HistoryIcon sx={{ fontSize: 28 }} />,
        title: 'Backtesting',
        description: 'Test your strategies against historical market data before deploying them live. Understand expected performance and risk.',
      },
    ],
  },
  {
    category: 'Execution & Monitoring',
    items: [
      {
        icon: <SmartToyIcon sx={{ fontSize: 28 }} />,
        title: 'Automated Execution',
        description: 'Bots execute trades 24/7 based on your rules. Set them up once and let them run on autopilot.',
      },
      {
        icon: <SpeedIcon sx={{ fontSize: 28 }} />,
        title: 'Low-latency Trading',
        description: 'Sub-100ms order placement ensures you capture opportunities the moment your conditions are met.',
      },
      {
        icon: <NotificationsActiveIcon sx={{ fontSize: 28 }} />,
        title: 'Real-time Alerts',
        description: 'Get notified instantly when bots execute trades, hit stop-losses, or encounter errors.',
      },
    ],
  },
  {
    category: 'Market Intelligence',
    items: [
      {
        icon: <ShowChartIcon sx={{ fontSize: 28 }} />,
        title: 'Live Orderbook',
        description: 'View real-time bid/ask spreads, market depth charts, and recent fills across trading pairs.',
      },
      {
        icon: <BarChartIcon sx={{ fontSize: 28 }} />,
        title: 'Performance Analytics',
        description: 'Track P&L, win rate, drawdown, and other key metrics with interactive charts and detailed reports.',
      },
      {
        icon: <AccountBalanceWalletIcon sx={{ fontSize: 28 }} />,
        title: 'Portfolio Overview',
        description: 'See your entire portfolio at a glance — asset allocation, holdings value, and performance across all connected exchanges.',
      },
    ],
  },
  {
    category: 'Platform & Security',
    items: [
      {
        icon: <IntegrationInstructionsIcon sx={{ fontSize: 28 }} />,
        title: 'Multi-exchange Support',
        description: 'Connect to Binance and other major exchanges. Manage all your accounts from a single dashboard.',
      },
      {
        icon: <SecurityIcon sx={{ fontSize: 28 }} />,
        title: 'Bank-grade Security',
        description: 'API keys encrypted at rest and in transit. We never request withdrawal permissions. SOC 2 compliant infrastructure.',
      },
      {
        icon: <DevicesIcon sx={{ fontSize: 28 }} />,
        title: 'Access Anywhere',
        description: 'Fully responsive web app works on desktop, tablet, and mobile. Monitor your bots from anywhere.',
      },
    ],
  },
] as const;

/** Comparison row for the "Why no-code?" section. */
const COMPARISONS = [
  'No programming skills required',
  'Deploy bots in minutes, not weeks',
  'Visual debugging — see exactly why a trade fired',
  'Modify strategies on the fly without redeployment',
  'Built-in risk management and safety controls',
] as const;

/**
 * Features page — detailed breakdown of platform capabilities.
 */
export default function Features() {
  return (
    <>
      {/* ─── Hero ──────────────────────────────────────────────── */}
      <Box
        sx={{
          pt: { xs: 8, md: 12 },
          pb: { xs: 6, md: 8 },
          background: `
            radial-gradient(ellipse at 30% 50%, rgba(0,198,251,0.06) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 20%, rgba(167,139,250,0.05) 0%, transparent 40%)
          `,
        }}
      >
        <Container maxWidth="md" sx={{ textAlign: 'center' }}>
          <Typography
            variant="h2"
            sx={{ fontSize: { xs: '2rem', md: '3rem' }, mb: 2 }}
          >
            Powerful features,{' '}
            <Box
              component="span"
              sx={{
                background: gradients.primary,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              zero complexity
            </Box>
          </Typography>
          <Typography variant="h6" color="text.secondary" fontWeight={400} sx={{ maxWidth: 560, mx: 'auto', lineHeight: 1.6 }}>
            Everything you need to build, deploy, and monitor trading bots — all from a visual interface.
          </Typography>
        </Container>
      </Box>

      {/* ─── Feature sections ──────────────────────────────────── */}
      {FEATURE_SECTIONS.map((section) => (
        <Box key={section.category} sx={{ py: { xs: 6, md: 8 } }}>
          <Container maxWidth="lg">
            <Typography
              variant="overline"
              color="primary.main"
              fontWeight={600}
              sx={{ letterSpacing: '0.1em', mb: 3, display: 'block' }}
            >
              {section.category}
            </Typography>

            <Grid container spacing={3}>
              {section.items.map((feature) => (
                <Grid key={feature.title} size={{ xs: 12, md: 4 }}>
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
                          width: 48,
                          height: 48,
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
                      <Typography variant="h6" sx={{ fontSize: '1rem', mb: 1 }}>
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
      ))}

      {/* ─── Why no-code ───────────────────────────────────────── */}
      <Box sx={{ py: { xs: 8, md: 10 }, borderTop: `1px solid ${colors.border.subtle}` }}>
        <Container maxWidth="md">
          <Grid container spacing={6} alignItems="center">
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="h3" sx={{ fontSize: { xs: '1.75rem', md: '2rem' }, mb: 2 }}>
                Why no-code?
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                Traditional algorithmic trading requires deep programming expertise and weeks of setup.
                Our visual builder lets anyone create sophisticated strategies in minutes.
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Stack spacing={2}>
                {COMPARISONS.map((item) => (
                  <Stack key={item} direction="row" spacing={1.5} alignItems="center">
                    <CheckCircleOutlineIcon sx={{ color: 'success.main', fontSize: 22 }} />
                    <Typography variant="body1">{item}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* ─── CTA ───────────────────────────────────────────────── */}
      <Box sx={{ py: { xs: 8, md: 10 } }}>
        <Container maxWidth="sm" sx={{ textAlign: 'center' }}>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.75rem', md: '2.25rem' }, mb: 2 }}>
            Start building your first bot
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
            Create a free account and have your first trading bot running in under 10 minutes.
          </Typography>
          <Button
            variant="contained"
            size="large"
            endIcon={<ArrowForwardIcon />}
            href={`${WEBAPP_URL}/register`}
            sx={{ px: 5, py: 1.5 }}
          >
            Get started free
          </Button>
        </Container>
      </Box>
    </>
  );
}
