import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ScienceIcon from '@mui/icons-material/Science';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useTheme } from '@mui/material/styles';
import { LineChart } from '@mui/x-charts/LineChart';
import StatCard from './StatCard';
import { useApi } from '../hooks/useApi';
import { formatDollar, formatNumber, formatPercent } from '../utils/format';
import { typography } from '@shared/styles/tokens';

/** Polling interval for checking backtest completion (15 seconds). */
const POLL_INTERVAL_MS = 15_000;

/** Backtest metadata from the API. */
interface BacktestMetadata {
  sub: string;
  backtestId: string;
  botId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  s3Key?: string;
  configChangedSinceTest: boolean;
  testedAt: string;
  completedAt?: string;
  windowStart: string;
  windowEnd: string;
  errorMessage?: string;
  summary?: BacktestSummary;
}

/** Backtest summary statistics. */
interface BacktestSummary {
  netPnl: number;
  winRate: number;
  totalTrades: number;
  totalBuys: number;
  totalSells: number;
  largestGain: number;
  largestLoss: number;
  avgHoldTimeMinutes: number;
}

/** Hourly bucket from the full report. */
interface HourlyBucket {
  hourStart: string;
  totalTrades: number;
  totalBuys: number;
  totalSells: number;
  realisedPnl: number;
  openPrice: number;
  closePrice: number;
}

/** Full backtest report returned from getBacktest endpoint. */
interface BacktestReportResponse extends BacktestMetadata {
  report?: {
    backtestId: string;
    botId: string;
    sub: string;
    windowStart: string;
    windowEnd: string;
    sizingMode: 'configured' | 'default_1000_aud';
    summary: BacktestSummary;
    hourlyBuckets: HourlyBucket[];
  };
}

/** Props for the {@link BacktestSection} component. */
interface BacktestSectionProps {
  botId: string;
}

/**
 * Backtesting section for the bot detail page. Provides a "Send for Testing"
 * button, progress polling, report display, and result history.
 *
 * @param props - Component props containing the botId.
 */
export default function BacktestSection({ botId }: BacktestSectionProps) {
  const { request } = useApi();
  const theme = useTheme();

  const [backtests, setBacktests] = useState<BacktestMetadata[]>([]);
  const [selectedBacktest, setSelectedBacktest] = useState<BacktestReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Fetch the list of backtests for this bot. */
  const fetchBacktests = useCallback(async () => {
    try {
      const data = await request<BacktestMetadata[]>(
        'GET',
        `/backtests/${botId}`,
      );
      setBacktests(data);
      return data;
    } catch {
      // Non-critical on initial load
      return [];
    }
  }, [request, botId]);

  /** Fetch the latest backtest status (used for polling). */
  const fetchLatest = useCallback(async () => {
    try {
      const data = await request<BacktestMetadata>(
        'GET',
        `/backtests/${botId}/latest`,
      );
      return data;
    } catch {
      return null;
    }
  }, [request, botId]);

  /** Fetch the full report for a specific backtest. */
  const fetchReport = useCallback(async (backtestId: string) => {
    setError(null);
    try {
      const data = await request<BacktestReportResponse>(
        'GET',
        `/backtests/${botId}/${backtestId}`,
      );
      setSelectedBacktest(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    }
  }, [request, botId]);

  /** Submit a new backtest. */
  const handleSubmit = useCallback(async () => {
    setConfirmOpen(false);
    setSubmitting(true);
    setError(null);
    try {
      const result = await request<{ backtestId: string; status: string }>(
        'POST',
        `/backtests/${botId}`,
      );
      // Refresh list and start polling
      await fetchBacktests();
      setSelectedBacktest(null);
      startPolling(result.backtestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit backtest');
    } finally {
      setSubmitting(false);
    }
  }, [request, botId, fetchBacktests]);

  /** Start polling for backtest completion. */
  const startPolling = useCallback((backtestId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const latest = await fetchLatest();
      if (latest && latest.backtestId === backtestId) {
        if (latest.status === 'completed' || latest.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          await fetchBacktests();
          if (latest.status === 'completed') {
            await fetchReport(backtestId);
          }
        }
      }
    }, POLL_INTERVAL_MS);
  }, [fetchLatest, fetchBacktests, fetchReport]);

  // Initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await fetchBacktests();
      if (data.length > 0) {
        const latest = data[0]!;
        if (latest.status === 'pending' || latest.status === 'running') {
          startPolling(latest.backtestId);
        } else if (latest.status === 'completed') {
          await fetchReport(latest.backtestId);
        }
      }
      setLoading(false);
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchBacktests, fetchReport, startPolling]);

  const isInFlight = backtests.some((b) => b.status === 'pending' || b.status === 'running');
  const latestBacktest = backtests.length > 0 ? backtests[0] : null;
  const report = selectedBacktest?.report;

  /** Shared sx for monospace table cells. */
  const monoCell = { fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' } as const;

  /** Derived chart data for the backtest price chart. */
  const chartData = useMemo(() => {
    if (!report || report.hourlyBuckets.length === 0) return null;
    const timestamps = report.hourlyBuckets.map((b) => new Date(b.hourStart));
    const closePrices = report.hourlyBuckets.map((b) => b.closePrice);
    const priceMin = Math.min(...closePrices);
    const priceMax = Math.max(...closePrices);
    const priceRange = priceMax - priceMin;
    const offset = priceRange * 0.015;

    const buyArr = new Array<number | null>(timestamps.length).fill(null);
    const sellArr = new Array<number | null>(timestamps.length).fill(null);
    report.hourlyBuckets.forEach((b, i) => {
      if (b.totalBuys > 0) buyArr[i] = b.closePrice - offset;
      if (b.totalSells > 0) sellArr[i] = b.closePrice + offset;
    });

    return { timestamps, closePrices, priceMin, priceMax, buyArr, sellArr };
  }, [report]);

  if (loading) {
    return (
      <Box sx={{ py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box>
      {/* Section Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <ScienceIcon color="primary" />
          <Typography variant="h6">Backtesting</Typography>
        </Stack>
        <Tooltip title={isInFlight ? 'A backtest is already running' : 'Test this bot against 30 days of historical data'}>
          <span>
            <Button
              variant="contained"
              startIcon={<ScienceIcon />}
              onClick={() => setConfirmOpen(true)}
              disabled={isInFlight || submitting}
            >
              {submitting ? 'Submitting...' : 'Send for Testing'}
            </Button>
          </span>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Start Backtest</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will replay your bot's buy and sell rules against 30 days of real
            historical BTC price data. The backtest usually takes 5–10 minutes —
            we'll show you the results when it's ready.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained">Start Backtest</Button>
        </DialogActions>
      </Dialog>

      {/* In-Flight Progress */}
      {isInFlight && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
              <ScheduleIcon color="primary" />
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2">Testing in progress</Typography>
                <Typography variant="caption" color="text.secondary">
                  Your backtest is running. This takes a few minutes — we're doing
                  the hard work so you don't have to.
                </Typography>
              </Box>
            </Stack>
            <LinearProgress />
          </CardContent>
        </Card>
      )}

      {/* Report Display */}
      {report && selectedBacktest?.status === 'completed' && (
        <>
          {/* Config Changed Warning */}
          {selectedBacktest?.configChangedSinceTest && (
            <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
              Config has changed since this test — results may not reflect current bot rules.
            </Alert>
          )}

          {/* Summary Cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <StatCard
                title="Total Trades"
                value={String(report.summary.totalTrades)}
                interval={`${report.summary.totalBuys} buys / ${report.summary.totalSells} sells`}
                trend="neutral"
                trendLabel={String(report.summary.totalTrades)}
                data={[report.summary.totalBuys, report.summary.totalSells]}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <StatCard
                title="Net P&L"
                value={`${report.summary.netPnl >= 0 ? '+' : ''}${formatDollar(report.summary.netPnl)}`}
                interval="Simulated across 30 days"
                trend={report.summary.netPnl > 0 ? 'up' : report.summary.netPnl < 0 ? 'down' : 'neutral'}
                trendLabel={`${report.summary.netPnl >= 0 ? '+' : ''}${formatDollar(report.summary.netPnl)}`}
                data={[0, report.summary.netPnl]}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <StatCard
                title="Win Rate"
                value={formatPercent(report.summary.winRate, 1).replace('+', '')}
                interval={`${report.summary.avgHoldTimeMinutes}min avg hold time`}
                trend={report.summary.winRate >= 50 ? 'up' : report.summary.winRate > 0 ? 'down' : 'neutral'}
                trendLabel={formatPercent(report.summary.winRate, 1).replace('+', '')}
                data={[0, report.summary.winRate]}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <StatCard
                title="Best / Worst Trade"
                value={formatDollar(report.summary.largestGain)}
                interval={`Worst: ${formatDollar(report.summary.largestLoss)}`}
                trend={report.summary.largestGain > Math.abs(report.summary.largestLoss) ? 'up' : 'down'}
                trendLabel={formatDollar(report.summary.largestGain)}
                data={[report.summary.largestLoss, 0, report.summary.largestGain]}
              />
            </Grid>
          </Grid>

          {/* Sizing Mode Label */}
          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            Sizing: {report.sizingMode === 'configured' ? "Bot's configured sizing" : 'Default $1,000 AUD per trade'}
            &nbsp;·&nbsp;Window: {new Date(report.windowStart).toLocaleDateString()} – {new Date(report.windowEnd).toLocaleDateString()}
          </Typography>

          {/* Price Chart with Buy/Sell Markers */}
          {chartData && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom>
                  BTC Price (30d) with Simulated Trade Signals
                </Typography>
                <Box sx={{ width: '100%', mt: 1 }}>
                  <LineChart
                    height={350}
                    xAxis={[{
                      data: chartData.timestamps,
                      scaleType: 'time',
                      valueFormatter: (v: Date) => v.toLocaleDateString([], { month: 'short', day: 'numeric' }),
                    }]}
                    yAxis={[{
                      min: chartData.priceMin * 0.999,
                      max: chartData.priceMax * 1.001,
                      valueFormatter: (v: number) => formatDollar(v, 0),
                    }]}
                    series={[
                      {
                        data: chartData.closePrices,
                        label: 'Price',
                        area: true,
                        color: theme.palette.primary.main,
                        showMark: false,
                        valueFormatter: (v: number | null) => v != null ? formatDollar(v, 2) : '',
                      },
                      ...(chartData.buyArr.some((v) => v !== null) ? [{
                        id: 'bt-buy-markers',
                        data: chartData.buyArr,
                        label: 'Buy',
                        color: theme.palette.success.main,
                        showMark: true,
                        shape: 'triangle' as const,
                        connectNulls: false,
                        disableHighlight: true,
                        valueFormatter: (v: number | null) => v != null ? `Buy @ ${formatDollar(v, 2)}` : '',
                      }] : []),
                      ...(chartData.sellArr.some((v) => v !== null) ? [{
                        id: 'bt-sell-markers',
                        data: chartData.sellArr,
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
                        fill: 'url(#bt-price-gradient)',
                      },
                      '& .MuiMarkElement-series-bt-buy-markers, & .MuiMarkElement-series-bt-sell-markers': {
                        transform: 'scale(1.8)',
                        strokeWidth: 2,
                      },
                      '& .MuiMarkElement-series-bt-sell-markers': {
                        transformOrigin: 'center',
                        transformBox: 'fill-box',
                        transform: 'scale(1.8) rotate(180deg)',
                      },
                      '& .MuiLineElement-series-bt-buy-markers, & .MuiLineElement-series-bt-sell-markers': {
                        display: 'none',
                      },
                    }}
                  >
                    <defs>
                      <linearGradient id="bt-price-gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                  </LineChart>
                </Box>
              </CardContent>
            </Card>
          )}

          {/* Hourly Trade Log */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Hourly Trade Log</Typography>
          <Card sx={{ mb: 3 }}>
            <TableContainer sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Hour</TableCell>
                    <TableCell align="right">Trades</TableCell>
                    <TableCell align="right">Buys</TableCell>
                    <TableCell align="right">Sells</TableCell>
                    <TableCell align="right">P&L</TableCell>
                    <TableCell align="right">Open</TableCell>
                    <TableCell align="right">Close</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.hourlyBuckets
                    .filter((b) => b.totalTrades > 0)
                    .map((bucket) => (
                      <TableRow key={bucket.hourStart}>
                        <TableCell sx={monoCell}>
                          {new Date(bucket.hourStart).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell align="right">{bucket.totalTrades}</TableCell>
                        <TableCell align="right">
                          {bucket.totalBuys > 0 && (
                            <Chip label={bucket.totalBuys} size="small" color="success" variant="outlined" />
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {bucket.totalSells > 0 && (
                            <Chip label={bucket.totalSells} size="small" color="error" variant="outlined" />
                          )}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            fontFamily: typography.fontFamily.mono,
                            fontSize: '0.8125rem',
                            color: bucket.realisedPnl > 0 ? theme.palette.success.main : bucket.realisedPnl < 0 ? theme.palette.error.main : undefined,
                          }}
                        >
                          {bucket.realisedPnl !== 0 ? `${bucket.realisedPnl > 0 ? '+' : ''}${formatDollar(bucket.realisedPnl)}` : '—'}
                        </TableCell>
                        <TableCell align="right" sx={monoCell}>
                          {formatDollar(bucket.openPrice, 0)}
                        </TableCell>
                        <TableCell align="right" sx={monoCell}>
                          {formatDollar(bucket.closePrice, 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </>
      )}

      {/* Failed State */}
      {latestBacktest?.status === 'failed' && !isInFlight && (
        <Alert severity="error" icon={<ErrorOutlineIcon />} sx={{ mb: 3 }}>
          Backtest failed{latestBacktest.errorMessage ? `: ${latestBacktest.errorMessage}` : '. Please try again.'}
        </Alert>
      )}

      {/* No backtests yet */}
      {backtests.length === 0 && !isInFlight && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <ScienceIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography variant="body1" color="text.secondary">
              No backtests yet
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Send this bot for testing to see how it would have performed against 30 days of historical data.
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Result History */}
      {backtests.length > 1 && (
        <>
          <Divider sx={{ my: 3 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Previous Results</Typography>
          <Stack spacing={1}>
            {backtests.map((bt) => (
              <Card
                key={bt.backtestId}
                sx={{
                  cursor: bt.status === 'completed' ? 'pointer' : 'default',
                  opacity: bt.backtestId === selectedBacktest?.backtestId ? 1 : 0.8,
                  borderLeft: bt.backtestId === selectedBacktest?.backtestId ? `3px solid ${theme.palette.primary.main}` : 'none',
                  '&:hover': bt.status === 'completed' ? { opacity: 1 } : undefined,
                }}
                onClick={() => bt.status === 'completed' && fetchReport(bt.backtestId)}
              >
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" alignItems="center" spacing={1}>
                      {bt.status === 'completed' && <CheckCircleOutlineIcon fontSize="small" color="success" />}
                      {bt.status === 'failed' && <ErrorOutlineIcon fontSize="small" color="error" />}
                      {(bt.status === 'pending' || bt.status === 'running') && <ScheduleIcon fontSize="small" color="primary" />}
                      <Typography variant="body2" sx={monoCell}>
                        {new Date(bt.testedAt).toLocaleString()}
                      </Typography>
                      {bt.configChangedSinceTest && (
                        <Tooltip title="Config has changed since this test">
                          <WarningAmberIcon fontSize="small" color="warning" />
                        </Tooltip>
                      )}
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={2}>
                      {bt.summary && (
                        <>
                          <Typography
                            variant="body2"
                            sx={{
                              fontFamily: typography.fontFamily.mono,
                              color: bt.summary.netPnl >= 0 ? theme.palette.success.main : theme.palette.error.main,
                            }}
                          >
                            {bt.summary.netPnl >= 0 ? '+' : ''}{formatDollar(bt.summary.netPnl)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {formatNumber(bt.summary.winRate, 1)}% win
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {bt.summary.totalTrades} trades
                          </Typography>
                        </>
                      )}
                      <Chip
                        label={bt.status}
                        size="small"
                        color={
                          bt.status === 'completed' ? 'success'
                            : bt.status === 'failed' ? 'error'
                              : 'default'
                        }
                        variant="outlined"
                      />
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
}
