import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { gradients, colors, effects } from '@shared/styles/tokens';
/** Base URL for the authenticated webapp (no trailing slash). */
const WEBAPP_URL = import.meta.env.VITE_WEBAPP_URL as string;

/** Plan definition. */
interface Plan {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

/** Pricing tiers. */
const PLANS: Plan[] = [
  {
    name: 'Free',
    price: '$0',
    period: '/month',
    description: 'Perfect for getting started with automated trading.',
    features: [
      'Up to 3 active bots',
      'Swyftx exchange',
      'Full indicator access (RSI, MACD, EMA, SMA, BB, Volume)',
      'Natural language bot builder',
    ],
    cta: 'Get started free',
  },
  {
    name: 'Pro',
    price: '$19',
    period: '/month',
    description: 'For serious traders who want more bots and exchanges.',
    features: [
      'Up to 10 active bots',
      'All Phase 1 exchanges (Swyftx, CoinSpot, CoinJar)',
      'Full indicator access (RSI, MACD, EMA, SMA, BB, Volume)',
      'Natural language bot builder',
      'Mirror kickback programme',
    ],
    cta: 'Start with Pro',
    highlighted: true,
  },
  {
    name: 'Elite',
    price: '$49',
    period: '/month',
    description: 'Unlimited bots, all exchanges, and AI-powered insights.',
    features: [
      'Unlimited active bots',
      'All exchanges (Phase 1 + Phase 2 as released)',
      'Full indicator access (RSI, MACD, EMA, SMA, BB, Volume)',
      'Natural language bot builder',
      'AI trade analysis & performance insights',
      'Mirror kickback programme',
    ],
    cta: 'Go Elite',
  },
];

/** FAQ item data. */
const FAQS = [
  {
    question: 'Can I change plans at any time?',
    answer: 'Yes. You can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle.',
  },
  {
    question: 'What happens if I downgrade?',
    answer: 'If you exceed the limits of your new tier (e.g. too many active bots), your existing bots will be paused — never deleted. You can re-enable them by upgrading again.',
  },
  {
    question: 'What exchanges do you support?',
    answer: 'Phase 1 exchanges include Swyftx, CoinSpot, and CoinJar. More exchanges are being added in Phase 2. Free users have access to Swyftx, Pro to all Phase 1, and Elite to all exchanges.',
  },
  {
    question: 'How do you handle my API keys?',
    answer: 'All API keys are encrypted at rest using AES-256 and transmitted over TLS. We only request trade permissions — never withdrawal access.',
  },
  {
    question: 'What is the Mirror Kickback Programme?',
    answer: 'Paid-tier traders earn credit when other paid users mirror their portfolio. You accrue 20% of each copier\'s monthly subscription fee as billing credit, calculated hourly.',
  },
] as const;

/**
 * Pricing page — plan comparison, FAQ section.
 */
export default function Pricing() {
  return (
    <>
      {/* ─── Hero ──────────────────────────────────────────────── */}
      <Box
        sx={{
          pt: { xs: 8, md: 12 },
          pb: { xs: 6, md: 8 },
          background: `
            radial-gradient(ellipse at 30% 50%, rgba(139,92,246,0.06) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 20%, rgba(167,139,250,0.05) 0%, transparent 40%)
          `,
        }}
      >
        <Container maxWidth="md" sx={{ textAlign: 'center' }}>
          <Typography
            variant="h2"
            sx={{ fontSize: { xs: '2rem', md: '3rem' }, mb: 2 }}
          >
            Simple,{' '}
            <Box
              component="span"
              sx={{
                background: gradients.primary,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              transparent pricing
            </Box>
          </Typography>
          <Typography variant="h6" color="text.secondary" fontWeight={400} sx={{ maxWidth: 500, mx: 'auto', lineHeight: 1.6 }}>
            Start free and scale as you grow. No hidden fees, no surprises.
          </Typography>
        </Container>
      </Box>

      {/* ─── Pricing cards ─────────────────────────────────────── */}
      <Box sx={{ py: { xs: 4, md: 6 } }}>
        <Container maxWidth="lg">
          <Grid container spacing={3} justifyContent="center">
            {PLANS.map((plan) => (
              <Grid key={plan.name} size={{ xs: 12, sm: 6, lg: 4 }}>
                <Card
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    ...(plan.highlighted && {
                      borderColor: colors.primary.main,
                      boxShadow: effects.shadow.glow,
                    }),
                  }}
                >
                  <CardContent sx={{ p: 4, flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <Typography variant="h5">{plan.name}</Typography>
                      {plan.highlighted && (
                        <Chip label="Popular" size="small" color="primary" />
                      )}
                    </Stack>

                    <Stack direction="row" alignItems="baseline" sx={{ mb: 1 }}>
                      <Typography
                        variant="h3"
                        sx={{
                          fontSize: '2.5rem',
                          ...(plan.highlighted && {
                            background: gradients.primary,
                            backgroundClip: 'text',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                          }),
                        }}
                      >
                        {plan.price}
                      </Typography>
                      {plan.period && (
                        <Typography variant="body1" color="text.secondary" sx={{ ml: 0.5 }}>
                          {plan.period}
                        </Typography>
                      )}
                    </Stack>

                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                      {plan.description}
                    </Typography>

                    <Stack spacing={1.5} sx={{ mb: 4, flex: 1 }}>
                      {plan.features.map((feature) => (
                        <Stack key={feature} direction="row" spacing={1.5} alignItems="flex-start">
                          <CheckIcon sx={{ color: 'success.main', fontSize: 20, mt: 0.2 }} />
                          <Typography variant="body2">{feature}</Typography>
                        </Stack>
                      ))}
                    </Stack>

                    <Button
                      variant={plan.highlighted ? 'contained' : 'outlined'}
                      size="large"
                      fullWidth
                      endIcon={<ArrowForwardIcon />}
                      href={`${WEBAPP_URL}/register`}
                    >
                      {plan.cta}
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* ─── FAQ ───────────────────────────────────────────────── */}
      <Box sx={{ py: { xs: 8, md: 10 }, borderTop: `1px solid ${colors.border.subtle}` }}>
        <Container maxWidth="md">
          <Typography
            variant="h3"
            sx={{ fontSize: { xs: '1.75rem', md: '2.25rem' }, mb: 6, textAlign: 'center' }}
          >
            Frequently asked questions
          </Typography>

          <Stack spacing={4}>
            {FAQS.map((faq) => (
              <Box key={faq.question}>
                <Typography variant="h6" sx={{ fontSize: '1rem', mb: 1 }}>
                  {faq.question}
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                  {faq.answer}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Container>
      </Box>

      {/* ─── CTA ───────────────────────────────────────────────── */}
      <Box sx={{ py: { xs: 8, md: 10 } }}>
        <Container maxWidth="sm" sx={{ textAlign: 'center' }}>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.75rem', md: '2.25rem' }, mb: 2 }}>
            Start trading smarter today
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
            No credit card required. Create your account and have a bot running in minutes.
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
