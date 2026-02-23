import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import { areaElementClasses } from '@mui/x-charts/LineChart';
import type { Trend } from '../data/mockData';

interface StatCardProps {
  title: string;
  value: string;
  interval: string;
  trend: Trend;
  trendLabel: string;
  data: number[];
}

/** Colour mapping for trend directions. */
function useTrendInfo(trend: Trend) {
  const theme = useTheme();
  const map = {
    up: {
      color: theme.palette.success.main,
      chipColor: 'success' as const,
    },
    down: {
      color: theme.palette.error.main,
      chipColor: 'error' as const,
    },
    neutral: {
      color: theme.palette.text.secondary,
      chipColor: 'default' as const,
    },
  };
  return map[trend];
}

/**
 * Dashboard stat card with title, value, trend chip, and sparkline chart.
 * Adapted from the MUI dashboard template StatCard pattern.
 */
export default function StatCard({ title, value, interval, trend, trendLabel, data }: StatCardProps) {
  const trendInfo = useTrendInfo(trend);

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flex: 1 }}>
        <Typography variant="subtitle2" gutterBottom>
          {title}
        </Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h4" component="p">
            {value}
          </Typography>
          <Chip size="small" color={trendInfo.chipColor} label={trendLabel} />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {interval}
        </Typography>
      </CardContent>
      <SparkLineChart
        data={data}
        height={50}
        area
        showHighlight
        showTooltip
        color={trendInfo.color}
        sx={{
          mx: 2,
          mb: 1,
          [`& .${areaElementClasses.root}`]: {
            fill: `url(#area-gradient-${trend})`,
          },
        }}
      >
        <defs>
          <linearGradient id={`area-gradient-${trend}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trendInfo.color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={trendInfo.color} stopOpacity={0} />
          </linearGradient>
        </defs>
      </SparkLineChart>
    </Card>
  );
}
