import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useApi } from '../hooks/useApi';
import { formatDollar, formatNumber } from '../utils/format';
import type { BotAction, BotStatus, ExecutionMode } from '../data/mockData';
import type { RuleGroupType } from 'react-querybuilder';

/** API bot record shape. */
interface ApiBotRecord {
  sub: string;
  botId: string;
  name: string;
  pair: string;
  status: BotStatus;
  executionMode: ExecutionMode;
  buyQuery?: RuleGroupType;
  sellQuery?: RuleGroupType;
  createdAt: string;
  updatedAt: string;
}

/** API trade record shape. */
interface ApiTradeRecord {
  botId: string;
  timestamp: string;
  sub: string;
  pair: string;
  action: BotAction;
  price: number;
  indicators: Record<string, number | string>;
  createdAt: string;
}

/** Status chip colour mapping. */
const statusColor: Record<BotStatus, 'success' | 'warning' | 'default'> = {
  active: 'success',
  paused: 'warning',
  draft: 'default',
};

/**
 * Bot detail page showing pair-specific information.
 *
 * Route: /bots/:pair (e.g. /bots/BTC)
 * Displays active bots on this pair and trade history.
 */
export default function BotDetail() {
  const { pair: pairParam } = useParams<{ pair: string }>();
  const navigate = useNavigate();
  const { request } = useApi();

  const displayPair = pairParam ?? '';

  const [bots, setBots] = useState<ApiBotRecord[]>([]);
  const [trades, setTrades] = useState<ApiTradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetch bots and trades for this pair. */
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [botsData, tradesData] = await Promise.all([
        request<{ items: ApiBotRecord[] }>('GET', '/bots'),
        request<{ items: ApiTradeRecord[] }>('GET', '/trades?limit=100'),
      ]);

      // Filter bots and trades for this pair
      setBots(botsData.items.filter((b) => b.pair === displayPair));
      setTrades(tradesData.items.filter((t) => t.pair === displayPair));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [request, displayPair]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** Find bot name by ID. */
  const botName = (botId: string) => bots.find((b) => b.botId === botId)?.name ?? botId;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
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
        <Typography variant="h5">{displayPair}</Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Active Bots on this pair */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Bots on this pair
      </Typography>
      {bots.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          No bots configured for {displayPair}.
        </Typography>
      ) : (
        <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 2 }}>
          {bots.map((bot) => (
            <Card key={bot.botId} sx={{ minWidth: 200 }}>
              <CardContent>
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Typography variant="subtitle2" noWrap>{bot.name}</Typography>
                  <Chip
                    label={bot.status}
                    size="small"
                    color={statusColor[bot.status]}
                    variant="outlined"
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {[bot.buyQuery && 'Buy', bot.sellQuery && 'Sell'].filter(Boolean).join(' + ')}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Trade History */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Trade History
      </Typography>
      {trades.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No trade signals recorded for {displayPair} yet.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Bot</TableCell>
                <TableCell>Action</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell align="right">RSI (14)</TableCell>
                <TableCell>MACD Signal</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {trades.map((trade) => (
                <TableRow key={`${trade.botId}-${trade.timestamp}`}>
                  <TableCell>{new Date(trade.timestamp).toLocaleString()}</TableCell>
                  <TableCell>{botName(trade.botId)}</TableCell>
                  <TableCell>
                    <Chip
                      label={trade.action.toUpperCase()}
                      size="small"
                      color={trade.action === 'buy' ? 'success' : 'error'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="right">
                    {typeof trade.price === 'number' ? formatDollar(trade.price) : trade.price}
                  </TableCell>
                  <TableCell align="right">
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
      )}
    </Box>
  );
}
