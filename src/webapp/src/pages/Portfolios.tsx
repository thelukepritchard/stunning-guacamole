import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid2';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { PieChart } from '@mui/x-charts/PieChart';
import { portfolios, allocationData, holdings } from '../data/mockData';

/** Portfolios page with summary cards, allocation chart, and holdings table. */
export default function Portfolios() {

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Portfolios
      </Typography>

      {/* Portfolio Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {portfolios.map((p) => (
          <Grid key={p.name} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom>
                  {p.name}
                </Typography>
                <Typography variant="h4" component="p">
                  ${p.value.toLocaleString()}
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    {p.assets} assets
                  </Typography>
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    color={p.change24h >= 0 ? 'success.main' : 'error.main'}
                  >
                    {p.change24h >= 0 ? '+' : ''}
                    {p.change24h}%
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Allocation Chart + Holdings Table */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Asset Allocation
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <PieChart
                  height={300}
                  series={[
                    {
                      data: allocationData.map((d, i) => ({
                        id: i,
                        value: d.value,
                        label: d.label,
                        color: d.color,
                      })),
                      innerRadius: 60,
                      outerRadius: 120,
                      paddingAngle: 2,
                      cornerRadius: 4,
                      highlightScope: { fade: 'global', highlight: 'item' },
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
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Holdings
              </Typography>
            </CardContent>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Asset</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell align="right">Avg Cost</TableCell>
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">Value</TableCell>
                    <TableCell align="right">P&L</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {holdings.map((h) => (
                    <TableRow key={h.asset}>
                      <TableCell>
                        <Typography fontWeight={600}>{h.asset}</Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                        {h.amount}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                        ${h.avgCost.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                        ${h.price.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                        ${h.value.toLocaleString()}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontFamily: 'monospace',
                          fontWeight: 600,
                          color: h.pnl >= 0 ? 'success.main' : 'error.main',
                        }}
                      >
                        {h.pnl >= 0 ? '+' : ''}
                        {h.pnl}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
