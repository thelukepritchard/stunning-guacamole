import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BacktestSection from '../components/BacktestSection';
import { useApi } from '../hooks/useApi';

/** Minimal bot record for the header. */
interface ApiBotRecord {
  botId: string;
  name: string;
  pair: string;
}

/**
 * Standalone backtesting page for a bot.
 *
 * Route: /bots/backtest/:botId
 */
export default function BotBacktest() {
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const { request } = useApi();

  const [bot, setBot] = useState<ApiBotRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetch bot details for the page header. */
  const fetchBot = useCallback(async () => {
    if (!botId) return;
    try {
      setLoading(true);
      const data = await request<ApiBotRecord>('GET', `/trading/bots/${botId}`);
      setBot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bot');
    } finally {
      setLoading(false);
    }
  }, [request, botId]);

  useEffect(() => { fetchBot(); }, [fetchBot]);

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
        <Typography variant="body2" color="text.secondary">{bot.pair}</Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <BacktestSection botId={bot.botId} />
    </Box>
  );
}
