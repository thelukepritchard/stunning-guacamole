import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
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
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTheme } from '@mui/material/styles';
import { LineChart } from '@mui/x-charts/LineChart';
import StatCard from '../components/StatCard';
import { useApi } from '../hooks/useApi';
import { formatDollar, formatNumber, formatPercent } from '../utils/format';
import { typography } from '@shared/styles/tokens';
import type { BotAction, BotStatus, ExecutionMode } from '../data/mockData';

/** API bot record shape. */
interface ApiBotRecord {
  sub: string;
  botId: string;
  name: string;
  pair: string;
  status: BotStatus;
  executionMode: ExecutionMode;
  createdAt: string;
  updatedAt: string;
}

/** API trade record shape. */
interface ApiTradeRecord {
  botId: string;
  timestamp: string;
  pair: string;
  action: BotAction;
  price: number;
  indicators: Record<string, number | string>;
  createdAt: string;
}

/** Price history item from API. */
interface PriceHistoryItem {
  pair: string;
  timestamp: string;
  price: number;
}

/** Status chip colour mapping. */
const statusColor: Record<BotStatus, 'success' | 'warning' | 'default'> = {
  active: 'success',
  paused: 'warning',
  draft: 'default',
};

/** Available time period options. */
const PRICE_PERIODS = ['1h', '6h', '24h', '7d', '30d'] as const;

/**
 * Individual bot detail page showing price chart with trade overlay
 * and P&L performance over time.
 *
 * Route: /bots/view/:botId
 */
export default function BotView() {
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const { request } = useApi();
  const theme = useTheme();

  const [bot, setBot] = useState<ApiBotRecord | null>(null);
  const [trades, setTrades] = useState<ApiTradeRecord[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryItem[]>([]);
  const [pnlSparkline, setPnlSparkline] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pricePeriod, setPricePeriod] = useState<string>('24h');

  /** Fetch bot details and trades. */
  const fetchBotData = useCallback(async () => {
    if (!botId) return;
    try {
      setLoading(true);
      setError(null);
      const [botData, tradesData] = await Promise.all([
        request<ApiBotRecord>('GET', `/bots/${botId}`),
        request<{ items: ApiTradeRecord[] }>('GET', `/trades/${botId}?limit=200`),
      ]);
      setBot(botData);
      setTrades(tradesData.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bot');
    } finally {
      setLoading(false);
    }
  }, [request, botId]);

  /** Fetch price history for the bot's pair. */
  const fetchPriceHistory = useCallback(async () => {
    if (!bot) return;
    try {
      const pairParam = bot.pair.replace('/', '-');
      const data = await request<{ items: PriceHistoryItem[] }>(
        'GET',
        `/market/prices/${pairParam}?period=${pricePeriod}`,
      );
      setPriceHistory(data.items);
    } catch (err) {
      console.error('Failed to fetch price history:', err);
    }
  }, [request, bot, pricePeriod]);

  /** Fetch P&L sparkline from performance snapshots. */
  const fetchPnlSparkline = useCallback(async () => {
    if (!botId) return;
    try {
      const data = await request<{ items: { netPnl: number }[] }>(
        'GET',
        `/analytics/bots/${botId}/performance?period=7d`,
      );
      setPnlSparkline(data.items.map((p) => p.netPnl));
    } catch {
      // Non-critical — sparkline just stays empty
    }
  }, [request, botId]);

  useEffect(() => { fetchBotData(); }, [fetchBotData]);
  useEffect(() => { fetchPriceHistory(); }, [fetchPriceHistory]);
  useEffect(() => { fetchPnlSparkline(); }, [fetchPnlSparkline]);

  // ─── Computed Stats ─────────────────────────────────────────────

  const totalTrades = trades.length;
  const buyTrades = trades.filter((t) => t.action === 'buy');
  const sellTrades = trades.filter((t) => t.action === 'sell');
  const totalBuyValue = buyTrades.reduce((a, b) => a + b.price, 0);
  const totalSellValue = sellTrades.reduce((a, b) => a + b.price, 0);
  const avgBuy = buyTrades.length > 0 ? totalBuyValue / buyTrades.length : 0;
  const realisedPnl = sellTrades.length > 0 ? totalSellValue - (sellTrades.length * avgBuy) : 0;
  const netPosition = buyTrades.length - sellTrades.length;
  const latestPrice = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1]!.price : 0;
  const unrealisedPnl = netPosition > 0 ? netPosition * (latestPrice - avgBuy) : 0;
  const netPnl = realisedPnl + unrealisedPnl;
  const pnlTrend = netPnl > 0 ? 'up' : netPnl < 0 ? 'down' : 'neutral';
  const winningSells = sellTrades.filter((t) => t.price > avgBuy).length;
  const winRate = sellTrades.length > 0 ? (winningSells / sellTrades.length) * 100 : 0;

  // ─── Price Chart Data ───────────────────────────────────────────

  const priceTimestamps = priceHistory.map((p) => new Date(p.timestamp));
  const priceSeries = priceHistory.map((p) => p.price);

  // Map trades onto the price timeline for overlay markers
  // Offset buy markers below and sell markers above the price for visibility
  const priceRange = priceSeries.length > 0
    ? Math.max(...priceSeries) - Math.min(...priceSeries)
    : 0;
  const markerOffset = priceRange * 0.015;

  const buyMarkers: { x: Date; y: number }[] = [];
  const sellMarkers: { x: Date; y: number }[] = [];
  for (const trade of trades) {
    if (trade.action === 'buy') {
      buyMarkers.push({ x: new Date(trade.timestamp), y: trade.price - markerOffset });
    } else {
      sellMarkers.push({ x: new Date(trade.timestamp), y: trade.price + markerOffset });
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!bot) {
    return (
      <Box>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
          <IconButton onClick={() => navigate('/bots')}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h5">Bot not found</Typography>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
        <IconButton onClick={() => navigate('/bots')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5">{bot.name}</Typography>
        <Chip label={bot.status} size="small" color={statusColor[bot.status]} variant="outlined" />
        <Typography variant="body2" color="text.secondary">{bot.pair}</Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Stat Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="Total Trades"
            value={String(totalTrades)}
            interval={`${buyTrades.length} buys / ${sellTrades.length} sells`}
            trend="neutral"
            trendLabel={String(totalTrades)}
            data={trades.slice(-30).map((_, i) => i + 1)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="Net P&L"
            value={`${netPnl >= 0 ? '+' : ''}${formatDollar(netPnl)}`}
            interval="Realised + unrealised"
            trend={pnlTrend as 'up' | 'down' | 'neutral'}
            trendLabel={`${netPnl >= 0 ? '+' : ''}${formatDollar(netPnl)}`}
            data={pnlSparkline.length > 1 ? pnlSparkline : [0, netPnl]}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="Win Rate"
            value={formatPercent(winRate, 1).replace('+', '')}
            interval={`${winningSells} of ${sellTrades.length} sells profitable`}
            trend={winRate >= 50 ? 'up' : winRate > 0 ? 'down' : 'neutral'}
            trendLabel={formatPercent(winRate, 1).replace('+', '')}
            data={[winRate]}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="Net Position"
            value={`${netPosition} units`}
            interval="Buys minus sells"
            trend={netPosition > 0 ? 'up' : netPosition < 0 ? 'down' : 'neutral'}
            trendLabel={`${netPosition >= 0 ? '+' : ''}${netPosition}`}
            data={[netPosition]}
          />
        </Grid>
      </Grid>

      {/* Price Chart with Trade Overlay */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {bot.pair} Price
              </Typography>
              <Typography variant="caption" color="text.secondary">
                With buy/sell trade markers
              </Typography>
            </Box>
            <ToggleButtonGroup
              size="small"
              value={pricePeriod}
              exclusive
              onChange={(_, v) => v && setPricePeriod(v)}
            >
              {PRICE_PERIODS.map((p) => (
                <ToggleButton key={p} value={p}>{p}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
          <Box sx={{ width: '100%', mt: 1 }}>
            {priceHistory.length > 0 ? (
              <LineChart
                height={350}
                xAxis={[{
                  data: priceTimestamps,
                  scaleType: 'time',
                  valueFormatter: (v: Date) => v.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                }]}
                yAxis={[{
                  min: Math.min(...priceSeries) * 0.999,
                  max: Math.max(...priceSeries) * 1.001,
                  valueFormatter: (v: number) => formatDollar(v, 0),
                }]}
                series={[
                  {
                    data: priceSeries,
                    label: 'Price',
                    area: true,
                    color: theme.palette.primary.main,
                    showMark: false,
                    valueFormatter: (v: number | null) => v != null ? formatDollar(v, 2) : '',
                  },
                  ...(buyMarkers.length > 0 ? [{
                    id: 'buy-markers',
                    data: (() => {
                      const arr = new Array<number | null>(priceTimestamps.length).fill(null);
                      for (const m of buyMarkers) {
                        let bestIdx = -1;
                        let bestDist = Infinity;
                        for (let i = 0; i < priceTimestamps.length; i++) {
                          const dist = Math.abs(priceTimestamps[i]!.getTime() - m.x.getTime());
                          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                        }
                        if (bestIdx >= 0) arr[bestIdx] = m.y;
                      }
                      return arr;
                    })(),
                    label: 'Buy',
                    color: theme.palette.success.main,
                    showMark: true,
                    shape: 'triangle' as const,
                    connectNulls: false,
                    disableHighlight: true,
                    valueFormatter: (v: number | null) => v != null ? `Buy @ ${formatDollar(v, 2)}` : '',
                  }] : []),
                  ...(sellMarkers.length > 0 ? [{
                    id: 'sell-markers',
                    data: (() => {
                      const arr = new Array<number | null>(priceTimestamps.length).fill(null);
                      for (const m of sellMarkers) {
                        let bestIdx = -1;
                        let bestDist = Infinity;
                        for (let i = 0; i < priceTimestamps.length; i++) {
                          const dist = Math.abs(priceTimestamps[i]!.getTime() - m.x.getTime());
                          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                        }
                        if (bestIdx >= 0) arr[bestIdx] = m.y;
                      }
                      return arr;
                    })(),
                    label: 'Sell',
                    color: theme.palette.error.main,
                    showMark: true,
                    shape: 'triangle' as const,
                    connectNulls: false,
                    disableHighlight: true,
                    valueFormatter: (v: number | null) => v != null ? `Sell @ ${formatDollar(v, 2)}` : '',
                  }] : []),
                ]}
                sx={{
                  '& .MuiAreaElement-root': {
                    fill: 'url(#price-gradient)',
                  },
                  // Larger triangle markers
                  '& .MuiMarkElement-series-buy-markers, & .MuiMarkElement-series-sell-markers': {
                    transform: 'scale(1.8)',
                    strokeWidth: 2,
                  },
                  // Rotate sell triangles to point downward
                  '& .MuiMarkElement-series-sell-markers': {
                    transformOrigin: 'center',
                    transformBox: 'fill-box',
                    transform: 'scale(1.8) rotate(180deg)',
                  },
                  // Hide connecting lines for marker series
                  '& .MuiLineElement-series-buy-markers, & .MuiLineElement-series-sell-markers': {
                    display: 'none',
                  },
                }}
              >
                <defs>
                  <linearGradient id="price-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0} />
                  </linearGradient>
                </defs>
              </LineChart>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ py: 8, textAlign: 'center' }}>
                No price data available yet. Data populates every minute.
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Trade History */}
      <Divider sx={{ my: 3 }} />
      <Typography variant="h6" sx={{ mb: 2 }}>
        Trade History
      </Typography>
      {trades.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No trade signals recorded yet.
        </Typography>
      ) : (
        <Card>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell align="right">RSI (14)</TableCell>
                  <TableCell>MACD Signal</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow key={`${trade.botId}-${trade.timestamp}`}>
                    <TableCell sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                      {new Date(trade.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={trade.action.toUpperCase()}
                        size="small"
                        color={trade.action === 'buy' ? 'success' : 'error'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                      {typeof trade.price === 'number' ? formatDollar(trade.price) : trade.price}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                      {trade.indicators?.rsi_14 != null ? formatNumber(Number(trade.indicators.rsi_14), 1) : '—'}
                    </TableCell>
                    <TableCell>
                      {trade.indicators?.macd_signal ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
    </Box>
  );
}
