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
import { bids, asks, depthData, recentFills } from '../data/mockData';
import { typography } from '@shared/styles/tokens';

/** Orderbook page with buy/sell tables, depth chart, and recent fills. */
export default function Orderbook() {
  const theme = useTheme();

  const midPrice = ((bids[0]!.price + asks[0]!.price) / 2).toFixed(1);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 0.5 }}>
          <Typography variant="h5">BTC / USDT</Typography>
          <Typography
            variant="h6"
            color="text.secondary"
            sx={{ fontFamily: typography.fontFamily.mono }}
          >
            ${Number(midPrice).toLocaleString()}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          Live orderbook and recent market fills.
        </Typography>
      </Box>

      {/* Buy / Sell Order Tables */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent sx={{ pb: 0 }}>
              <Typography variant="subtitle2" color="success.main">
                Buy Orders (Bids)
              </Typography>
            </CardContent>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Price</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {bids.map((entry, i) => (
                    <TableRow key={i}>
                      <TableCell sx={{ color: 'success.main', fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                        {entry.price.toLocaleString(undefined, { minimumFractionDigits: 1 })}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                        {entry.amount.toFixed(3)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                        ${entry.total.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent sx={{ pb: 0 }}>
              <Typography variant="subtitle2" color="error.main">
                Sell Orders (Asks)
              </Typography>
            </CardContent>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Price</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {asks.map((entry, i) => (
                    <TableRow key={i}>
                      <TableCell sx={{ color: 'error.main', fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                        {entry.price.toLocaleString(undefined, { minimumFractionDigits: 1 })}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                        {entry.amount.toFixed(3)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                        ${entry.total.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>
      </Grid>

      {/* Depth Chart */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            Market Depth
          </Typography>
          <Box sx={{ width: '100%' }}>
            <LineChart
              height={300}
              xAxis={[
                {
                  data: depthData.map((d) => d.price),
                  scaleType: 'linear',
                  valueFormatter: (v: number) => v.toLocaleString(),
                },
              ]}
              series={[
                {
                  data: depthData.map((d) => d.bids),
                  label: 'Bids',
                  area: true,
                  color: theme.palette.success.main,
                  showMark: false,
                  connectNulls: false,
                },
                {
                  data: depthData.map((d) => d.asks),
                  label: 'Asks',
                  area: true,
                  color: theme.palette.error.main,
                  showMark: false,
                  connectNulls: false,
                },
              ]}
              sx={{
                '& .MuiAreaElement-root:first-of-type': {
                  fillOpacity: 0.15,
                },
                '& .MuiAreaElement-root:last-of-type': {
                  fillOpacity: 0.15,
                },
              }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Recent Fills */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Recent Fills
      </Typography>
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Side</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recentFills.map((fill, i) => (
                <TableRow key={i}>
                  <TableCell sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>{fill.time}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                    {fill.price.toLocaleString(undefined, { minimumFractionDigits: 1 })}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: typography.fontFamily.mono, fontSize: '0.8125rem' }}>
                    {fill.amount.toFixed(3)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={fill.side}
                      size="small"
                      color={fill.side === 'Buy' ? 'success' : 'error'}
                      variant="outlined"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
}
