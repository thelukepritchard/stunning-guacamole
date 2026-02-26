import { useState, useEffect, useCallback } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Grid from '@mui/material/Grid2';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import StatCard from '../components/StatCard';
import { useApi } from '../hooks/useApi';
import { typography } from '@shared/styles/tokens';
import { formatDollar } from '../utils/format';
import type { Trend } from '../data/mockData';

// ─── API Response Types ─────────────────────────────────────────

/** Balance response from the orderbook API. */
interface BalanceResponse {
  exchange: string;
  currency: string;
  available: number;
}

/** Bot record from the trading API. */
interface ApiBotRecord {
  botId: string;
  name: string;
  status: 'active' | 'paused' | 'draft';
}

/** Portfolio performance snapshot from the portfolio API. */
interface PerformanceSnapshot {
  timestamp: string;
  activeBots: number;
  totalNetPnl: number;
  totalRealisedPnl: number;
  totalUnrealisedPnl: number;
  pnl24h: number;
}

/** Order response from the orderbook API. */
interface OrderResponse {
  orderId: string;
  status: string;
}

/** Trade record from the trading API. */
interface ApiTradeRecord {
  botId: string;
  timestamp: string;
  pair: string;
  action: 'buy' | 'sell';
  price: number;
  trigger: string;
  createdAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Daily aggregated data point derived from performance snapshots. */
interface DailyPoint {
  date: string;
  netPnl: number;
  realisedPnl: number;
}

/**
 * Downsamples performance snapshots to daily data points by taking
 * the last snapshot of each calendar day.
 *
 * @param snapshots - Sorted performance snapshots (oldest first).
 * @returns One data point per day.
 */
function toDailyPoints(snapshots: PerformanceSnapshot[]): DailyPoint[] {
  if (snapshots.length === 0) return [];

  const byDay = new Map<string, PerformanceSnapshot>();
  for (const snap of snapshots) {
    const day = snap.timestamp.slice(0, 10);
    byDay.set(day, snap);
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, snap]) => ({
      date: new Date(snap.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      netPnl: snap.totalNetPnl,
      realisedPnl: snap.totalRealisedPnl,
    }));
}

/**
 * Evenly samples an array down to approximately `n` points.
 *
 * @param arr - Source array.
 * @param n - Target number of samples.
 * @returns Sampled array.
 */
function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]!);
}

// ─── Component ──────────────────────────────────────────────────

/** Dashboard landing page with real-time stats, charts, and recent trades. */
export default function Dashboard() {
  const theme = useTheme();
  const { request } = useApi();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [bots, setBots] = useState<ApiBotRecord[]>([]);
  const [performance, setPerformance] = useState<PerformanceSnapshot[]>([]);
  const [orders, setOrders] = useState<OrderResponse[]>([]);
  const [trades, setTrades] = useState<ApiTradeRecord[]>([]);

  /** Fetch all dashboard data in parallel. */
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [balanceRes, botsRes, perfRes, ordersRes, tradesRes] = await Promise.all([
        request<BalanceResponse>('GET', '/orderbook/balance'),
        request<{ items: ApiBotRecord[] }>('GET', '/trading/bots'),
        request<{ items: PerformanceSnapshot[] }>('GET', '/portfolio/performance?period=30d'),
        request<{ exchange: string; orders: OrderResponse[] }>('GET', '/orderbook/orders'),
        request<{ items: ApiTradeRecord[] }>('GET', '/trading/trades?limit=10'),
      ]);

      setBalance(balanceRes);
      setBots(botsRes.items);
      setPerformance(perfRes.items);
      setOrders(ordersRes.orders);
      setTrades(tradesRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Derived values ──────────────────────────────────────────────

  const activeBotCount = bots.filter((b) => b.status === 'active').length;
  const latestPerf = performance.length > 0 ? performance[performance.length - 1]! : null;
  const todayPnl = latestPerf?.pnl24h ?? 0;
  const openOrderCount = orders.filter((o) => o.status === 'open' || o.status === 'pending').length;

  // Sparklines — sample performance data to ~30 points
  const perfSampled = sample(performance, 30);
  const pnlSparkline = perfSampled.map((s) => s.totalNetPnl);
  const botsSparkline = perfSampled.map((s) => s.activeBots);
  const pnl24hSparkline = perfSampled.map((s) => s.pnl24h);

  const pnlTrend: Trend = todayPnl > 0 ? 'up' : todayPnl < 0 ? 'down' : 'neutral';
  const balanceTrend: Trend =
    pnlSparkline.length >= 2
      ? pnlSparkline[pnlSparkline.length - 1]! >= pnlSparkline[0]!
        ? 'up'
        : 'down'
      : 'neutral';

  const statCards = [
    {
      title: 'Cash Balance',
      value: formatDollar(balance?.available ?? 0, 0),
      interval: 'Available USD',
      trend: balanceTrend,
      trendLabel: latestPerf
        ? `${latestPerf.totalNetPnl >= 0 ? '+' : ''}${formatDollar(latestPerf.totalNetPnl, 0)} P&L`
        : '$0 P&L',
      sparkline: pnlSparkline.length > 0 ? pnlSparkline : [0],
    },
    {
      title: 'Active Bots',
      value: String(activeBotCount),
      interval: 'Currently running',
      trend: 'neutral' as Trend,
      trendLabel: `${bots.length} total`,
      sparkline: botsSparkline.length > 0 ? botsSparkline : [0],
    },
    {
      title: "Today's P&L",
      value: `${todayPnl >= 0 ? '+' : ''}${formatDollar(todayPnl)}`,
      interval: 'Last 24 hours',
      trend: pnlTrend,
      trendLabel: latestPerf
        ? `${latestPerf.totalNetPnl >= 0 ? '+' : ''}${formatDollar(latestPerf.totalNetPnl)} total`
        : '$0.00 total',
      sparkline: pnl24hSparkline.length > 0 ? pnl24hSparkline : [0],
    },
    {
      title: 'Open Orders',
      value: String(openOrderCount),
      interval: 'Across all bots',
      trend: 'neutral' as Trend,
      trendLabel: `${orders.length} total`,
      sparkline: [openOrderCount],
    },
  ];

  // Chart data — downsample to daily
  const dailyPoints = toDailyPoints(performance);

  // Bot name lookup for trades table
  const botNameMap = new Map(bots.map((b) => [b.botId, b.name]));

  // ── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Overview
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Track your portfolio, bots, and recent activity.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Stat Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {statCards.map((stat) => (
          <Grid key={stat.title} size={{ xs: 12, sm: 6, lg: 3 }}>
            <StatCard
              title={stat.title}
              value={stat.value}
              interval={stat.interval}
              trend={stat.trend}
              trendLabel={stat.trendLabel}
              data={stat.sparkline}
            />
          </Grid>
        ))}
      </Grid>

      {/* Charts Row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Portfolio Performance
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Net P&L — Last 30 days
              </Typography>
              {dailyPoints.length > 0 ? (
                <Box sx={{ width: '100%', mt: 1 }}>
                  <LineChart
                    height={300}
                    xAxis={[
                      {
                        data: dailyPoints.map((_, i) => i),
                        scaleType: 'point',
                        valueFormatter: (v: number) => dailyPoints[v]?.date ?? '',
                      },
                    ]}
                    yAxis={[{ valueFormatter: (v: number) => formatDollar(v, 0) }]}
                    series={[
                      {
                        data: dailyPoints.map((p) => p.netPnl),
                        area: true,
                        color: theme.palette.primary.main,
                        showMark: false,
                        valueFormatter: (v: number | null) => (v != null ? formatDollar(v) : ''),
                      },
                    ]}
                    sx={{
                      '& .MuiAreaElement-root': {
                        fill: 'url(#perf-gradient)',
                      },
                    }}
                  >
                    <defs>
                      <linearGradient id="perf-gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                  </LineChart>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                  <Typography variant="body2" color="text.secondary">
                    No performance data yet
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Realised P&L
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Daily realised profit — Last 30 days
              </Typography>
              {dailyPoints.length > 0 ? (
                <Box sx={{ width: '100%', mt: 1 }}>
                  <BarChart
                    height={300}
                    xAxis={[
                      {
                        data: dailyPoints.map((_, i) => i),
                        scaleType: 'band',
                        valueFormatter: (v: number) => dailyPoints[v]?.date ?? '',
                      },
                    ]}
                    yAxis={[{ valueFormatter: (v: number) => formatDollar(v, 0) }]}
                    series={[
                      {
                        data: dailyPoints.map((p) => p.realisedPnl),
                        color: theme.palette.primary.main,
                        valueFormatter: (v: number | null) => (v != null ? formatDollar(v) : ''),
                      },
                    ]}
                  />
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                  <Typography variant="body2" color="text.secondary">
                    No trading data yet
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Recent Trades */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Recent Trades
      </Typography>
      <Card>
        {trades.length > 0 ? (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Pair</TableCell>
                  <TableCell>Side</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell>Trigger</TableCell>
                  <TableCell>Bot</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow key={`${trade.botId}-${trade.timestamp}`}>
                    <TableCell sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                      {new Date(trade.createdAt).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>{trade.pair}</TableCell>
                    <TableCell>
                      <Chip
                        label={trade.action === 'buy' ? 'Buy' : 'Sell'}
                        size="small"
                        color={trade.action === 'buy' ? 'success' : 'error'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                      {formatDollar(trade.price)}
                    </TableCell>
                    <TableCell>
                      <Chip label={trade.trigger.replace('_', ' ')} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>{botNameMap.get(trade.botId) ?? trade.botId.slice(0, 8)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              No trades yet. Create and activate a bot to start trading.
            </Typography>
          </CardContent>
        )}
      </Card>
    </Box>
  );
}
