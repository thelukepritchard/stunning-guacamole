// ─── Demo Exchange Types ────────────────────────────────────────

/** Demo balance record stored in DynamoDB — one per user. */
export interface DemoBalanceRecord {
  /** User ID (partition key). */
  sub: string;
  /** Available USD balance. */
  usd: number;
  /** Available BTC balance. */
  btc: number;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** Demo order record stored in DynamoDB. */
export interface DemoOrderRecord {
  /** User ID (partition key). */
  sub: string;
  /** Unique order ID (sort key). */
  orderId: string;
  /** Trading pair (e.g. 'BTC/USD'). */
  pair: string;
  /** Order side. */
  side: 'buy' | 'sell';
  /** Order type — only market orders for now. */
  type: 'market';
  /** Quantity of base asset (BTC). */
  size: number;
  /** Execution price in quote currency (USD). */
  executedPrice: number;
  /** Total cost (buy) or proceeds (sell) in quote currency (USD). */
  total: number;
  /** Order status. */
  status: 'filled' | 'cancelled';
  /** ISO timestamp of creation. */
  createdAt: string;
}

/** Available demo trading pair. */
export interface DemoPair {
  /** Pair symbol (e.g. 'BTC/USD'). */
  symbol: string;
  /** Base asset ticker (e.g. 'BTC'). */
  base: string;
  /** Quote asset ticker (e.g. 'USD'). */
  quote: string;
}

/** Default starting USD balance for new demo users. */
export const DEFAULT_DEMO_BALANCE = 1000;

/** Available trading pairs in demo mode. */
export const DEMO_PAIRS: DemoPair[] = [
  { symbol: 'BTC/USD', base: 'BTC', quote: 'USD' },
];

/** Binance ticker API endpoint for BTC price (USDT ≈ USD for demo). */
export const BINANCE_TICKER_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';
