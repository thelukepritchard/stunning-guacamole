// ─── Orderbook Domain Types ─────────────────────────────────────

/** Normalised balance response returned by the orderbook API. */
export interface BalanceResponse {
  exchange: string;
  currency: string;
  available: number;
}

/** Normalised trading pair returned by the orderbook API. */
export interface PairResponse {
  symbol: string;
  coin: string;
  coinName: string;
}

/** Normalised pairs response returned by the orderbook API. */
export interface PairsResponse {
  exchange: string;
  baseCurrency: string;
  pairs: PairResponse[];
}

/** Normalised order returned by the orderbook API. */
export interface OrderResponse {
  orderId: string;
  pair: string;
  side: string;
  type: string;
  size: number;
  price: number;
  total: number;
  status: string;
  createdAt: string;
}

/** Normalised orders response returned by the orderbook API. */
export interface OrdersResponse {
  exchange: string;
  orders: OrderResponse[];
}

/** Coin name lookup for normalising pair responses. */
export const COIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  ADA: 'Cardano',
  DOT: 'Polkadot',
  LINK: 'Chainlink',
  AVAX: 'Avalanche',
  MATIC: 'Polygon',
  XRP: 'Ripple',
  DOGE: 'Dogecoin',
};
