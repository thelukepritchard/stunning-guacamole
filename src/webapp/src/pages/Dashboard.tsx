import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
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
import { dashboardStats, performanceData, volumeData, recentTrades } from '../data/mockData';
import { typography } from '@shared/styles/tokens';

/** Dashboard landing page with stats, charts, and recent trades. */
export default function Dashboard() {
  const theme = useTheme();

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

      {/* Stat Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {dashboardStats.map((stat) => (
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
                Last 30 days
              </Typography>
              <Box sx={{ width: '100%', mt: 1 }}>
                <LineChart
                  height={300}
                  xAxis={[
                    {
                      data: performanceData.map((_, i) => i),
                      scaleType: 'point',
                      valueFormatter: (v: number) => performanceData[v]!.date,
                    },
                  ]}
                  series={[
                    {
                      data: performanceData.map((p) => p.value),
                      area: true,
                      color: theme.palette.primary.main,
                      showMark: false,
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
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Trading Volume
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Daily volume (USD)
              </Typography>
              <Box sx={{ width: '100%', mt: 1 }}>
                <BarChart
                  height={300}
                  xAxis={[
                    {
                      data: volumeData.map((_, i) => i),
                      scaleType: 'band',
                      valueFormatter: (v: number) => volumeData[v]!.date,
                    },
                  ]}
                  series={[
                    {
                      data: volumeData.map((v) => v.volume),
                      color: theme.palette.primary.main,
                    },
                  ]}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Recent Trades */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Recent Trades
      </Typography>
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Pair</TableCell>
                <TableCell>Side</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell>Bot</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recentTrades.map((trade, i) => (
                <TableRow key={i}>
                  <TableCell sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>{trade.time}</TableCell>
                  <TableCell>{trade.pair}</TableCell>
                  <TableCell>
                    <Chip
                      label={trade.side}
                      size="small"
                      color={trade.side === 'Buy' ? 'success' : 'error'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                    {trade.price.toLocaleString()}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                    {trade.amount}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                    ${trade.total.toLocaleString()}
                  </TableCell>
                  <TableCell>{trade.bot}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
}
