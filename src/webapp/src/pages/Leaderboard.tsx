import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { useApi } from '../hooks/useApi';
import { formatDollar } from '../utils/format';
import { typography, colors, gradients } from '@shared/styles/tokens';

/** Leaderboard entry from the API. */
interface LeaderboardEntry {
  rank: number;
  username: string;
  activeBots: number;
  totalNetPnl: number;
  pnl24h: number;
  timestamp: string;
}

/** Medal colours for the top three positions. */
const MEDAL_COLORS: Record<number, string> = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
};

/**
 * Leaderboard page showing top traders ranked by 24-hour P&L.
 *
 * Fetches data from GET /analytics/leaderboard and displays a ranked
 * table with user avatars, active bot counts, and P&L figures.
 *
 * Route: /leaderboard
 */
export default function Leaderboard() {
  const { request } = useApi();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetch leaderboard data. */
  const fetchLeaderboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await request<{ items: LeaderboardEntry[] }>(
        'GET',
        '/analytics/leaderboard?limit=50',
      );
      setEntries(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

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
      <Box sx={{ mb: 4 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
          <EmojiEventsOutlinedIcon sx={{ color: '#FFD700', fontSize: 28 }} />
          <Typography variant="h5">Leaderboard</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Top traders ranked by profit in the last 24 hours
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {/* Top 3 Podium Cards */}
      {entries.length >= 3 && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
          {entries.slice(0, 3).map((entry) => (
            <Card
              key={entry.username}
              onClick={() => navigate(`/leaderboard/${entry.username}`)}
              sx={{
                flex: 1,
                position: 'relative',
                overflow: 'visible',
                borderTop: `3px solid ${MEDAL_COLORS[entry.rank]}`,
                cursor: 'pointer',
                '&:hover': { boxShadow: 4 },
                transition: 'box-shadow 0.2s',
              }}
            >
              <CardContent sx={{ textAlign: 'center', pt: 3 }}>
                <Avatar
                  sx={{
                    width: 48,
                    height: 48,
                    mx: 'auto',
                    mb: 1.5,
                    fontSize: 18,
                    fontWeight: 700,
                    background: entry.rank === 1 ? gradients.primary : undefined,
                    bgcolor: entry.rank !== 1 ? MEDAL_COLORS[entry.rank] : undefined,
                    color: colors.primary.contrast,
                  }}
                >
                  {entry.rank}
                </Avatar>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {entry.username}
                </Typography>
                <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} sx={{ mt: 0.5 }}>
                  <SmartToyOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                  <Typography variant="caption" color="text.secondary">
                    {entry.activeBots} bot{entry.activeBots !== 1 ? 's' : ''}
                  </Typography>
                </Stack>
                <Typography
                  variant="h6"
                  sx={{
                    mt: 1.5,
                    fontFamily: typography.fontFamily.mono,
                    color: entry.pnl24h >= 0 ? 'success.main' : 'error.main',
                  }}
                >
                  {entry.pnl24h >= 0 ? '+' : ''}{formatDollar(entry.pnl24h)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  24h Profit
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Full Leaderboard Table */}
      {entries.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <EmojiEventsOutlinedIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
              No leaderboard data yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              The leaderboard will populate once traders have active bots with performance data.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 60 }}>Rank</TableCell>
                  <TableCell>Trader</TableCell>
                  <TableCell align="center">Active Bots</TableCell>
                  <TableCell align="right">24h P&L</TableCell>
                  <TableCell align="right">Total P&L</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow
                    key={entry.username}
                    hover
                    onClick={() => navigate(`/leaderboard/${entry.username}`)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      {entry.rank <= 3 ? (
                        <Chip
                          label={`#${entry.rank}`}
                          size="small"
                          sx={{
                            fontWeight: 700,
                            bgcolor: `${MEDAL_COLORS[entry.rank]}20`,
                            color: MEDAL_COLORS[entry.rank],
                            border: `1px solid ${MEDAL_COLORS[entry.rank]}40`,
                          }}
                        />
                      ) : (
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: typography.fontFamily.mono, pl: 1 }}
                        >
                          #{entry.rank}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1.5}>
                        <Avatar
                          sx={{
                            width: 32,
                            height: 32,
                            fontSize: 13,
                            fontWeight: 600,
                            bgcolor: 'action.selected',
                          }}
                        >
                          {entry.username[0]?.toUpperCase() ?? '?'}
                        </Avatar>
                        <Typography variant="body2" fontWeight={500}>
                          {entry.username}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="center">
                      <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5}>
                        <SmartToyOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="body2" sx={{ fontFamily: typography.fontFamily.mono }}>
                          {entry.activeBots}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={0.5}>
                        {entry.pnl24h >= 0 ? (
                          <TrendingUpIcon sx={{ fontSize: 16, color: 'success.main' }} />
                        ) : (
                          <TrendingDownIcon sx={{ fontSize: 16, color: 'error.main' }} />
                        )}
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: typography.fontFamily.mono,
                            fontWeight: 600,
                            color: entry.pnl24h >= 0 ? 'success.main' : 'error.main',
                          }}
                        >
                          {entry.pnl24h >= 0 ? '+' : ''}{formatDollar(entry.pnl24h)}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: typography.fontFamily.mono,
                          color: entry.totalNetPnl >= 0 ? 'success.main' : 'error.main',
                        }}
                      >
                        {entry.totalNetPnl >= 0 ? '+' : ''}{formatDollar(entry.totalNetPnl)}
                      </Typography>
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
