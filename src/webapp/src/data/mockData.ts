import type { RuleGroupType } from 'react-querybuilder';

// ─── Shared Types ────────────────────────────────────────────────

/** Trend direction for stat cards. */
export type Trend = 'up' | 'down' | 'neutral';

/** A single dashboard stat card. */
export interface DashboardStat {
  title: string;
  value: string;
  interval: string;
  trend: Trend;
  trendLabel: string;
  sparkline: number[];
}

/** A daily performance data point. */
export interface PerformancePoint {
  date: string;
  value: number;
}

/** A recent trade row. */
export interface Trade {
  time: string;
  pair: string;
  side: 'Buy' | 'Sell';
  price: number;
  amount: number;
  total: number;
  bot: string;
}

/** An orderbook entry (bid or ask). */
export interface OrderbookEntry {
  price: number;
  amount: number;
  total: number;
}

/** A depth chart data point. */
export interface DepthPoint {
  price: number;
  bids: number | null;
  asks: number | null;
}

/** A recent fill in the orderbook. */
export interface Fill {
  time: string;
  price: number;
  amount: number;
  side: 'Buy' | 'Sell';
}

/** Bot status. */
export type BotStatus = 'active' | 'paused' | 'draft';

/** Bot action type. */
export type BotAction = 'buy' | 'sell';

/** Bot execution mode. */
export type ExecutionMode = 'once_and_wait' | 'condition_cooldown';

/** A trading bot. */
export interface Bot {
  id: string;
  name: string;
  pair: string;
  status: BotStatus;
  executionMode: ExecutionMode;
  createdAt: string;
  buyQuery?: RuleGroupType;
  sellQuery?: RuleGroupType;
}

// ─── Dashboard Data ──────────────────────────────────────────────

/** Helper to generate a sparkline array of `n` points around `base`. */
function spark(base: number, n: number, volatility: number): number[] {
  const data: number[] = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    v += (Math.random() - 0.45) * volatility;
    data.push(Math.round(v * 100) / 100);
  }
  return data;
}

/** Dashboard stat cards. */
export const dashboardStats: DashboardStat[] = [
  {
    title: 'Portfolio Value',
    value: '$124,532',
    interval: 'Last 30 days',
    trend: 'up',
    trendLabel: '+8.2%',
    sparkline: spark(115000, 30, 800),
  },
  {
    title: 'Active Bots',
    value: '7',
    interval: 'Currently running',
    trend: 'neutral',
    trendLabel: '0%',
    sparkline: spark(6, 30, 0.5),
  },
  {
    title: "Today's P&L",
    value: '+$1,243',
    interval: 'Since 00:00 UTC',
    trend: 'up',
    trendLabel: '+1.0%',
    sparkline: spark(0, 30, 200),
  },
  {
    title: 'Open Orders',
    value: '12',
    interval: 'Across all bots',
    trend: 'down',
    trendLabel: '-3',
    sparkline: spark(15, 30, 1.5),
  },
];

/** 30 days of portfolio performance data. */
export const performanceData: PerformancePoint[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(2025, 0, 25 + i);
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: 110000 + i * 500 + Math.round((Math.random() - 0.3) * 2000),
  };
});

/** 30 days of trading volume data. */
export const volumeData = performanceData.map((p) => ({
  date: p.date,
  volume: Math.round(3000 + Math.random() * 7000),
}));

/** Recent trades table data. */
export const recentTrades: Trade[] = [
  { time: '14:32:05', pair: 'BTC', side: 'Buy', price: 97243.5, amount: 0.015, total: 1458.65, bot: 'Grid Bot #1' },
  { time: '14:28:11', pair: 'ETH', side: 'Sell', price: 3421.8, amount: 1.2, total: 4106.16, bot: 'DCA Bot #2' },
  { time: '14:15:44', pair: 'SOL', side: 'Buy', price: 187.32, amount: 12.0, total: 2247.84, bot: 'Grid Bot #3' },
  { time: '13:58:22', pair: 'BTC', side: 'Buy', price: 97180.0, amount: 0.008, total: 777.44, bot: 'Grid Bot #1' },
  { time: '13:45:09', pair: 'AVAX', side: 'Sell', price: 38.45, amount: 50.0, total: 1922.5, bot: 'Momentum #1' },
  { time: '13:32:55', pair: 'ETH', side: 'Buy', price: 3415.2, amount: 0.5, total: 1707.6, bot: 'DCA Bot #2' },
  { time: '13:20:18', pair: 'LINK', side: 'Buy', price: 19.87, amount: 100.0, total: 1987.0, bot: 'Grid Bot #4' },
  { time: '13:05:41', pair: 'SOL', side: 'Sell', price: 186.95, amount: 8.0, total: 1495.6, bot: 'Grid Bot #3' },
];

// ─── Orderbook Data ──────────────────────────────────────────────

/** Bid (buy) entries — highest price first. */
export const bids: OrderbookEntry[] = [
  { price: 97240.0, amount: 0.245, total: 23823.8 },
  { price: 97235.5, amount: 0.128, total: 12446.14 },
  { price: 97230.0, amount: 0.512, total: 49781.76 },
  { price: 97225.0, amount: 0.087, total: 8458.58 },
  { price: 97220.0, amount: 0.334, total: 32471.48 },
  { price: 97215.5, amount: 0.156, total: 15165.62 },
  { price: 97210.0, amount: 0.721, total: 70088.41 },
  { price: 97205.0, amount: 0.093, total: 9040.07 },
  { price: 97200.0, amount: 0.445, total: 43254.0 },
  { price: 97195.0, amount: 0.268, total: 26048.26 },
];

/** Ask (sell) entries — lowest price first. */
export const asks: OrderbookEntry[] = [
  { price: 97245.0, amount: 0.198, total: 19254.51 },
  { price: 97250.0, amount: 0.312, total: 30342.0 },
  { price: 97255.5, amount: 0.087, total: 8461.23 },
  { price: 97260.0, amount: 0.445, total: 43280.7 },
  { price: 97265.0, amount: 0.156, total: 15173.34 },
  { price: 97270.0, amount: 0.523, total: 50872.21 },
  { price: 97275.5, amount: 0.234, total: 22762.47 },
  { price: 97280.0, amount: 0.098, total: 9533.44 },
  { price: 97285.0, amount: 0.367, total: 35703.6 },
  { price: 97290.0, amount: 0.189, total: 18387.81 },
];

/** Cumulative depth chart data. */
export const depthData: DepthPoint[] = (() => {
  const points: DepthPoint[] = [];
  let cumBid = 0;
  for (let i = bids.length - 1; i >= 0; i--) {
    cumBid += bids[i]!.amount;
    points.push({ price: bids[i]!.price, bids: Math.round(cumBid * 1000) / 1000, asks: null });
  }
  let cumAsk = 0;
  for (const ask of asks) {
    cumAsk += ask.amount;
    points.push({ price: ask.price, bids: null, asks: Math.round(cumAsk * 1000) / 1000 });
  }
  return points;
})();

/** Recent fills for the orderbook. */
export const recentFills: Fill[] = [
  { time: '14:32:05', price: 97243.5, amount: 0.015, side: 'Buy' },
  { time: '14:31:58', price: 97244.0, amount: 0.032, side: 'Sell' },
  { time: '14:31:42', price: 97242.0, amount: 0.108, side: 'Buy' },
  { time: '14:31:35', price: 97245.5, amount: 0.045, side: 'Sell' },
  { time: '14:31:20', price: 97241.0, amount: 0.067, side: 'Buy' },
  { time: '14:31:12', price: 97243.0, amount: 0.023, side: 'Sell' },
  { time: '14:31:01', price: 97240.5, amount: 0.091, side: 'Buy' },
  { time: '14:30:55', price: 97244.5, amount: 0.054, side: 'Sell' },
  { time: '14:30:42', price: 97239.0, amount: 0.128, side: 'Buy' },
  { time: '14:30:30', price: 97242.5, amount: 0.076, side: 'Sell' },
];

// ─── Bots Data ──────────────────────────────────────────────────

/** Available trading pairs (coin tickers). */
export const tradingPairs = [
  'BTC',
] as const;

/** @deprecated Bots are now fetched from the trading API. */
export const bots: Bot[] = [];
