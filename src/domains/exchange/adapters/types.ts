import type { BalanceResponse, PairsResponse, OrdersResponse } from '../../shared/types';

/** Decrypted exchange credentials needed by adapters. */
export interface ExchangeCredentials {
  /** Decrypted API key. */
  apiKey: string;
  /** Decrypted API secret. */
  apiSecret: string;
  /** User's base currency for this exchange connection. */
  baseCurrency: string;
}

/** Parameters for placing a market order on an exchange. */
export interface PlaceOrderParams {
  /** Trading pair (e.g. 'BTC'). */
  pair: string;
  /** Order side. */
  side: 'buy' | 'sell';
  /** Order size in the base asset (e.g. BTC quantity). */
  size: number;
}

/** Result of a market order placement. */
export interface PlaceOrderResult {
  /** Whether the order was filled or failed. */
  status: 'filled' | 'failed';
  /** Exchange-assigned order identifier (present on success). */
  orderId?: string;
  /** Reason for failure (present when status is 'failed'). */
  failReason?: string;
}

/**
 * Interface for exchange adapters. Each supported exchange implements this
 * to provide a uniform API for credential validation and trading operations.
 */
export interface ExchangeAdapter {
  /** Validates that the provided credentials are accepted by the exchange. */
  validateCredentials(creds: ExchangeCredentials): Promise<boolean>;
  /** Fetches the account balance from the exchange. */
  getBalance(creds: ExchangeCredentials): Promise<BalanceResponse>;
  /** Fetches available trading pairs from the exchange. */
  getPairs(creds: ExchangeCredentials): Promise<PairsResponse>;
  /** Fetches recent orders from the exchange. */
  getOrders(creds: ExchangeCredentials): Promise<OrdersResponse>;
  /** Places a market order on the exchange. */
  placeOrder(creds: ExchangeCredentials, params: PlaceOrderParams): Promise<PlaceOrderResult>;
}
