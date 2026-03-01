import { useState, useEffect, useCallback } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { useTheme } from '@mui/material/styles';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import StatCard from '../components/StatCard';
import { useApi } from '../hooks/useApi';
import { useExchange } from '../contexts/ExchangeContext';
import { typography } from '@shared/styles/tokens';
import { formatNumber, formatDollar } from '../utils/format';
import type { Trend } from '../data/mockData';

// ─── API Response Types ─────────────────────────────────────────

/** A single holding in the user's portfolio. */
interface HoldingEntry {
  asset: string;
  name: string;
  amount: number;
  price: number;
  value: number;
}

/** Balance response from the exchange API. */
interface BalanceResponse {
  exchange: string;
  currency: string;
  totalValue: number;
  holdings: HoldingEntry[];
  message?: string;
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

/** Position sizing configuration. */
interface SizingConfig {
  type: 'fixed' | 'percentage';
  value: number;
}

/** Indicator snapshot from the trading API. */
interface IndicatorSnapshot {
  price: number;
  volume_24h: number;
  price_change_pct: number;
  rsi_14: number;
  rsi_7: number;
  macd_histogram: number;
  macd_signal: string;
  sma_20: number;
  sma_50: number;
  sma_200: number;
  ema_12: number;
  ema_20: number;
  ema_26: number;
  bb_upper: number;
  bb_lower: number;
  bb_position: string;
}

/** Supported exchange identifiers. */
type ExchangeId = 'demo' | 'swyftx' | 'coinspot' | 'coinjar' | 'kraken_pro' | 'binance';

/** Human-readable exchange display names. */
const EXCHANGE_NAMES: Record<ExchangeId, string> = {
  demo: 'Demo',
  swyftx: 'Swyftx',
  coinspot: 'CoinSpot',
  coinjar: 'CoinJar',
  kraken_pro: 'Kraken Pro',
  binance: 'Binance',
};

/** Trade record from the trading API. */
interface ApiTradeRecord {
  botId: string;
  timestamp: string;
  pair: string;
  action: 'buy' | 'sell';
  price: number;
  trigger: string;
  sizing?: SizingConfig;
  orderStatus?: 'filled' | 'failed' | 'skipped';
  orderId?: string;
  failReason?: string;
  exchangeId?: ExchangeId;
  indicators?: IndicatorSnapshot;
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

/** Brand colours for asset allocation pie chart slices. */
const ALLOCATION_COLORS: Record<string, string> = {
  USD: '#4caf50',
  AUD: '#002f6c',
  BTC: '#f7931a',
};

// ─── Component ──────────────────────────────────────────────────

/** Dashboard landing page with real-time stats, charts, and recent trades. */
export default function Dashboard() {
  const theme = useTheme();
  const { request } = useApi();
  const { activeExchange } = useExchange();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [bots, setBots] = useState<ApiBotRecord[]>([]);
  const [performance, setPerformance] = useState<PerformanceSnapshot[]>([]);
  const [orders, setOrders] = useState<OrderResponse[]>([]);
  const [trades, setTrades] = useState<ApiTradeRecord[]>([]);
  const [selectedTrade, setSelectedTrade] = useState<ApiTradeRecord | null>(null);

  /** Fetch all dashboard data in parallel. */
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [balanceRes, botsRes, perfRes, ordersRes, tradesRes] = await Promise.all([
        request<BalanceResponse>('GET', '/exchange/balance'),
        request<{ items: ApiBotRecord[] }>('GET', `/bots?exchangeId=${activeExchange}`),
        request<{ items: PerformanceSnapshot[] }>('GET', '/analytics/performance?period=30d'),
        request<{ exchange: string; orders: OrderResponse[] }>('GET', '/exchange/orders'),
        request<{ items: ApiTradeRecord[] }>('GET', `/trades?limit=10&exchangeId=${activeExchange}`),
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
  }, [request, activeExchange]);

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
      title: 'Portfolio Performance',
      value: `${(latestPerf?.totalNetPnl ?? 0) >= 0 ? '+' : ''}${formatDollar(latestPerf?.totalNetPnl ?? 0, 0)}`,
      interval: 'Cumulative P&L',
      trend: balanceTrend,
      trendLabel: latestPerf
        ? `${latestPerf.pnl24h >= 0 ? '+' : ''}${formatDollar(latestPerf.pnl24h, 0)} today`
        : '$0 today',
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

  // Pie chart data from holdings
  const allocationData = (balance?.holdings ?? []).map((h, i) => ({
    id: i,
    value: balance && balance.totalValue > 0 ? (h.value / balance.totalValue) * 100 : 0,
    label: h.asset,
    color: ALLOCATION_COLORS[h.asset] ?? '#94a3b8',
  }));

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

      {/* Asset Allocation + Holdings */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Asset Allocation
              </Typography>
              {allocationData.length > 0 ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                  <PieChart
                    height={300}
                    series={[
                      {
                        data: allocationData,
                        innerRadius: 60,
                        outerRadius: 120,
                        paddingAngle: 2,
                        cornerRadius: 4,
                        highlightScope: { fade: 'global', highlight: 'item' },
                        valueFormatter: (v) => `${v.value.toFixed(1)}%`,
                      },
                    ]}
                    width={350}
                    slotProps={{
                      legend: {
                        position: { vertical: 'bottom', horizontal: 'center' },
                      },
                    }}
                  />
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                  <Typography variant="body2" color="text.secondary">
                    {balance?.message ?? 'No funds found on this exchange'}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Holdings
              </Typography>
            </CardContent>
            {(balance?.holdings ?? []).length > 0 ? (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Asset</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell align="right">Price</TableCell>
                      <TableCell align="right">Value</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {balance?.holdings.map((h) => (
                      <TableRow key={h.asset}>
                        <TableCell>
                          <Typography fontWeight={600}>{h.asset}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {h.name}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                          {formatNumber(h.amount, h.asset === 'USD' ? 2 : 6)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                          {h.asset === 'USD' ? '-' : formatDollar(h.price)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                          {formatDollar(h.value)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  {balance?.message ?? 'No funds found on this exchange'}
                </Typography>
              </CardContent>
            )}
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
                  <TableCell>Status</TableCell>
                  <TableCell>Bot</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow
                    key={`${trade.botId}-${trade.timestamp}`}
                    hover
                    onClick={() => setSelectedTrade(trade)}
                    sx={{ cursor: 'pointer' }}
                  >
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
                    <TableCell>
                      <Chip
                        label={
                          trade.orderStatus === 'failed'
                            ? `Failed${trade.failReason ? ` — ${trade.failReason}` : ''}`
                            : trade.orderStatus === 'skipped'
                              ? 'Skipped'
                              : 'Filled'
                        }
                        size="small"
                        color={
                          trade.orderStatus === 'failed'
                            ? 'error'
                            : trade.orderStatus === 'skipped'
                              ? 'warning'
                              : 'success'
                        }
                        variant="outlined"
                      />
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

      {/* Trade Detail Modal */}
      <Dialog
        open={!!selectedTrade}
        onClose={() => setSelectedTrade(null)}
        maxWidth="sm"
        fullWidth
      >
        {selectedTrade && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Chip
                  label={selectedTrade.action === 'buy' ? 'Buy' : 'Sell'}
                  color={selectedTrade.action === 'buy' ? 'success' : 'error'}
                  size="small"
                />
                <Typography variant="h6">
                  {selectedTrade.pair}
                </Typography>
              </Stack>
              <IconButton size="small" onClick={() => setSelectedTrade(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </DialogTitle>
            <DialogContent>
              {/* Order Status */}
              <Box sx={{ mb: 2.5 }}>
                <Chip
                  label={
                    selectedTrade.orderStatus === 'failed'
                      ? 'Failed'
                      : selectedTrade.orderStatus === 'skipped'
                        ? 'Skipped'
                        : 'Filled'
                  }
                  color={
                    selectedTrade.orderStatus === 'failed'
                      ? 'error'
                      : selectedTrade.orderStatus === 'skipped'
                        ? 'warning'
                        : 'success'
                  }
                  size="small"
                />
                {selectedTrade.failReason && (
                  <Typography variant="body2" color="error.main" sx={{ mt: 1 }}>
                    {selectedTrade.failReason}
                  </Typography>
                )}
              </Box>

              <Divider sx={{ mb: 2 }} />

              {/* Trade Details */}
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Trade Details</Typography>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Price</Typography>
                  <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                    {formatDollar(selectedTrade.price)}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Trigger</Typography>
                  <Typography variant="body2">
                    {selectedTrade.trigger.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </Typography>
                </Grid>
                {selectedTrade.sizing && (
                  <>
                    <Grid size={6}>
                      <Typography variant="caption" color="text.secondary">Position Size</Typography>
                      <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                        {selectedTrade.sizing.type === 'fixed'
                          ? formatDollar(selectedTrade.sizing.value)
                          : `${selectedTrade.sizing.value}%`}
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="caption" color="text.secondary">Sizing Type</Typography>
                      <Typography variant="body2">
                        {selectedTrade.sizing.type === 'fixed' ? 'Fixed Amount' : 'Percentage'}
                      </Typography>
                    </Grid>
                  </>
                )}
                {selectedTrade.sizing && selectedTrade.sizing.type === 'fixed' && selectedTrade.price > 0 && (
                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">
                      Est. {selectedTrade.pair} Quantity
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                      {formatNumber(selectedTrade.sizing.value / selectedTrade.price, 6)}
                    </Typography>
                  </Grid>
                )}
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Exchange</Typography>
                  <Typography variant="body2">
                    {EXCHANGE_NAMES[(selectedTrade.exchangeId ?? 'demo') as ExchangeId] ?? selectedTrade.exchangeId}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Bot</Typography>
                  <Typography variant="body2">
                    {botNameMap.get(selectedTrade.botId) ?? selectedTrade.botId.slice(0, 8)}
                  </Typography>
                </Grid>
                {selectedTrade.orderId && (
                  <Grid size={12}>
                    <Typography variant="caption" color="text.secondary">Order ID</Typography>
                    <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.75rem' }}>
                      {selectedTrade.orderId}
                    </Typography>
                  </Grid>
                )}
              </Grid>

              {/* Timestamps */}
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Timing</Typography>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Signal Time</Typography>
                  <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.75rem' }}>
                    {new Date(selectedTrade.timestamp).toLocaleString()}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Recorded At</Typography>
                  <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.75rem' }}>
                    {new Date(selectedTrade.createdAt).toLocaleString()}
                  </Typography>
                </Grid>
              </Grid>

              {/* Market Indicators */}
              {selectedTrade.indicators && (
                <>
                  <Divider sx={{ mb: 2 }} />
                  <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Market Indicators at Signal</Typography>
                  <Grid container spacing={2}>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">RSI (14)</Typography>
                      <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                        {formatNumber(selectedTrade.indicators.rsi_14, 1)}
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">RSI (7)</Typography>
                      <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                        {formatNumber(selectedTrade.indicators.rsi_7, 1)}
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">MACD Signal</Typography>
                      <Typography variant="body2">
                        {selectedTrade.indicators.macd_signal}
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">SMA 20</Typography>
                      <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                        {formatDollar(selectedTrade.indicators.sma_20, 0)}
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">SMA 50</Typography>
                      <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                        {formatDollar(selectedTrade.indicators.sma_50, 0)}
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">SMA 200</Typography>
                      <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                        {formatDollar(selectedTrade.indicators.sma_200, 0)}
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">BB Upper</Typography>
                      <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                        {formatDollar(selectedTrade.indicators.bb_upper, 0)}
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">BB Lower</Typography>
                      <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                        {formatDollar(selectedTrade.indicators.bb_lower, 0)}
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">BB Position</Typography>
                      <Typography variant="body2">
                        {selectedTrade.indicators.bb_position}
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">Volume (24h)</Typography>
                      <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                        {formatNumber(selectedTrade.indicators.volume_24h, 0)}
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">Price Change</Typography>
                      <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                        {formatNumber(selectedTrade.indicators.price_change_pct, 2)}%
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Typography variant="caption" color="text.secondary">MACD Histogram</Typography>
                      <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                        {formatNumber(selectedTrade.indicators.macd_histogram, 2)}
                      </Typography>
                    </Grid>
                  </Grid>
                </>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  );
}
