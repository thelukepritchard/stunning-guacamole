import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { LineChart } from '@mui/x-charts/LineChart';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { useApi } from '../hooks/useApi';
import { formatDollar } from '../utils/format';
import { typography, colors, gradients } from '@shared/styles/tokens';

/** Summary metrics returned by the API. */
interface TraderSummary {
  activeBots: number;
  totalNetPnl: number;
  totalRealisedPnl: number;
  totalUnrealisedPnl: number;
  pnl24h: number;
  lastUpdated: string;
}

/** Performance snapshot from the API. */
interface PerformancePoint {
  timestamp: string;
  totalNetPnl: number;
  totalRealisedPnl: number;
  totalUnrealisedPnl: number;
  pnl24h: number;
  activeBots: number;
}

/** Full trader profile response from the API. */
interface TraderProfileData {
  username: string;
  createdAt: string;
  summary: TraderSummary | null;
  performance: PerformancePoint[];
}

/** Available period options for the performance chart. */
const PERIODS = ['24h', '7d', '30d'] as const;
type Period = typeof PERIODS[number];

/**
 * Formats a timestamp string for chart axis labels based on the selected period.
 *
 * @param ts - ISO timestamp string.
 * @param p - The selected time period.
 * @returns Formatted time or date string.
 */
function formatAxisDate(ts: string, p: Period): string {
  const d = new Date(ts);
  if (p === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Public trader profile page showing portfolio stats and performance chart.
 *
 * Fetches data from GET /analytics/leaderboard/{username} and displays
 * summary metrics with a P&L chart over time.
 *
 * Route: /leaderboard/:username
 */
export default function TraderProfile() {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const { request } = useApi();

  const [profile, setProfile] = useState<TraderProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('7d');

  /** Fetch the trader's profile data for the selected period. */
  const fetchProfile = useCallback(async () => {
    if (!username) return;
    try {
      setLoading(true);
      setError(null);
      const data = await request<TraderProfileData>(
        'GET',
        `/analytics/leaderboard/${encodeURIComponent(username)}?period=${period}`,
      );
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trader profile');
    } finally {
      setLoading(false);
    }
  }, [request, username, period]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/leaderboard')}
          sx={{ mb: 2 }}
        >
          Back to Leaderboard
        </Button>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!profile) return <Alert severity="error">Profile unavailable.</Alert>;

  const { summary, performance } = profile;

  return (
    <Box>
      {/* Header */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/leaderboard')}
        sx={{ mb: 2 }}
      >
        Back to Leaderboard
      </Button>

      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <Avatar
          sx={{
            width: 56,
            height: 56,
            fontSize: 22,
            fontWeight: 700,
            background: gradients.primary,
            color: colors.primary.contrast,
          }}
        >
          {profile.username[0]?.toUpperCase() ?? '?'}
        </Avatar>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            {profile.username}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Member since {new Date(profile.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </Typography>
        </Box>
      </Stack>

      {/* Summary Stat Cards */}
      {summary ? (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  24h P&L
                </Typography>
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5 }}>
                  {summary.pnl24h >= 0 ? (
                    <TrendingUpIcon sx={{ fontSize: 20, color: 'success.main' }} />
                  ) : (
                    <TrendingDownIcon sx={{ fontSize: 20, color: 'error.main' }} />
                  )}
                  <Typography
                    variant="h5"
                    sx={{
                      fontFamily: typography.fontFamily.mono,
                      fontWeight: 600,
                      color: summary.pnl24h >= 0 ? 'success.main' : 'error.main',
                    }}
                  >
                    {summary.pnl24h >= 0 ? '+' : ''}{formatDollar(summary.pnl24h)}
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Total Net P&L
                </Typography>
                <Typography
                  variant="h5"
                  sx={{
                    mt: 0.5,
                    fontFamily: typography.fontFamily.mono,
                    fontWeight: 600,
                    color: summary.totalNetPnl >= 0 ? 'success.main' : 'error.main',
                  }}
                >
                  {summary.totalNetPnl >= 0 ? '+' : ''}{formatDollar(summary.totalNetPnl)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Realised / Unrealised
                </Typography>
                <Typography
                  variant="h6"
                  sx={{ mt: 0.5, fontFamily: typography.fontFamily.mono, fontWeight: 600 }}
                >
                  {formatDollar(summary.totalRealisedPnl)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  / {formatDollar(summary.totalUnrealisedPnl)} unrealised
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Active Bots
                </Typography>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
                  <SmartToyOutlinedIcon sx={{ color: 'primary.main' }} />
                  <Typography variant="h5" fontWeight={600}>
                    {summary.activeBots}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Last updated {new Date(summary.lastUpdated).toLocaleTimeString()}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      ) : (
        <Alert severity="info" sx={{ mb: 3 }}>
          This trader has no performance data yet.
        </Alert>
      )}

      {/* Performance Chart */}
      {performance.length > 0 && (
        <Card>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Box>
                <Typography variant="subtitle2">
                  Performance
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Net P&L over time
                </Typography>
              </Box>
              <ToggleButtonGroup
                value={period}
                exclusive
                onChange={(_, v) => { if (v) setPeriod(v as Period); }}
                size="small"
              >
                {PERIODS.map((p) => (
                  <ToggleButton key={p} value={p}>
                    {p}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Stack>
            <Box sx={{ width: '100%' }}>
              <LineChart
                height={350}
                xAxis={[
                  {
                    data: performance.map((_, i) => i),
                    scaleType: 'point',
                    valueFormatter: (v: number) => performance[v] ? formatAxisDate(performance[v].timestamp, period) : '',
                  },
                ]}
                yAxis={[{ valueFormatter: (v: number | null) => v != null ? formatDollar(v, 0) : '' }]}
                series={[
                  {
                    data: performance.map((p) => p.totalNetPnl),
                    label: 'Net P&L',
                    area: true,
                    color: theme.palette.primary.main,
                    showMark: false,
                    valueFormatter: (v: number | null) => v != null ? formatDollar(v) : '',
                  },
                ]}
                sx={{
                  '& .MuiAreaElement-root': {
                    fill: 'url(#trader-perf-gradient)',
                  },
                }}
              >
                <defs>
                  <linearGradient id="trader-perf-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0} />
                  </linearGradient>
                </defs>
              </LineChart>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Pnl Breakdown Chart */}
      {performance.length > 0 && (
        <Card sx={{ mt: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              P&L Breakdown
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Realised vs Unrealised P&L
            </Typography>
            <Box sx={{ width: '100%', mt: 1 }}>
              <LineChart
                height={250}
                xAxis={[
                  {
                    data: performance.map((_, i) => i),
                    scaleType: 'point',
                    valueFormatter: (v: number) => performance[v] ? formatAxisDate(performance[v].timestamp, period) : '',
                  },
                ]}
                yAxis={[{ valueFormatter: (v: number | null) => v != null ? formatDollar(v, 0) : '' }]}
                series={[
                  {
                    data: performance.map((p) => p.totalRealisedPnl),
                    label: 'Realised',
                    color: theme.palette.success.main,
                    showMark: false,
                    valueFormatter: (v: number | null) => v != null ? formatDollar(v) : '',
                  },
                  {
                    data: performance.map((p) => p.totalUnrealisedPnl),
                    label: 'Unrealised',
                    color: theme.palette.warning.main,
                    showMark: false,
                    valueFormatter: (v: number | null) => v != null ? formatDollar(v) : '',
                  },
                ]}
              />
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
