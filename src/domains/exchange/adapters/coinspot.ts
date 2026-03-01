import { createHmac } from 'crypto';
import type { BalanceResponse, PairsResponse, OrdersResponse, HoldingEntry, PairResponse, OrderResponse } from '../../shared/types';
import { COIN_NAMES } from '../../shared/types';
import type { ExchangeAdapter, ExchangeCredentials, PlaceOrderParams, PlaceOrderResult } from './types';

const BASE_URL = 'https://www.coinspot.com.au';

/**
 * Signs a CoinSpot API request body using HMAC-SHA512.
 *
 * @param body - The JSON request body including a `nonce` field.
 * @param secret - The API secret used for signing.
 * @returns Hex-encoded HMAC-SHA512 signature.
 */
function sign(body: string, secret: string): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

/**
 * Makes a signed POST request to the CoinSpot API.
 *
 * @param path - The API path (e.g. '/api/ro/my/balances').
 * @param creds - The exchange credentials.
 * @param extraBody - Additional body fields to include.
 * @returns The parsed JSON response.
 */
async function signedRequest<T>(path: string, creds: ExchangeCredentials, extraBody: Record<string, unknown> = {}): Promise<T> {
  const body = JSON.stringify({ nonce: Date.now(), ...extraBody });
  const signature = sign(body, creds.apiSecret);

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'key': creds.apiKey,
      'sign': signature,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`CoinSpot ${path} failed: ${res.status}`);
  }

  return (await res.json()) as T;
}

/**
 * CoinSpot exchange adapter.
 *
 * Authentication: Each request is signed with HMAC-SHA512. The JSON body
 * includes a `nonce` (epoch milliseconds). Headers include `key` (API key)
 * and `sign` (HMAC hex digest).
 */
export const coinspotAdapter: ExchangeAdapter = {
  /**
   * Validates credentials by calling the read-only status endpoint.
   * A response with `{ "status": "ok" }` confirms the key is valid.
   */
  async validateCredentials(creds: ExchangeCredentials): Promise<boolean> {
    try {
      const data = await signedRequest<{ status?: string }>('/api/ro/status', creds);
      return data.status === 'ok';
    } catch {
      return false;
    }
  },

  /**
   * Fetches the account balance from CoinSpot.
   * Calls POST /api/ro/my/balances to get all coin holdings.
   */
  async getBalance(creds: ExchangeCredentials): Promise<BalanceResponse> {
    const data = await signedRequest<{
      status: string;
      balances: Array<Record<string, { balance: number; audbalance: number; rate: number }>>;
    }>('/api/ro/my/balances', creds);

    const holdings: HoldingEntry[] = [];
    let totalValue = 0;

    for (const balanceObj of data.balances ?? []) {
      for (const [ticker, info] of Object.entries(balanceObj)) {
        if (info.balance <= 0) continue;
        // Skip holdings worth less than 1 cent
        if (info.audbalance < 0.01) continue;
        const upper = ticker.toUpperCase();
        holdings.push({
          asset: upper,
          name: COIN_NAMES[upper] ?? upper,
          amount: info.balance,
          price: info.rate,
          value: info.audbalance,
        });
        totalValue += info.audbalance;
      }
    }

    return {
      exchange: 'coinspot',
      currency: 'AUD',
      totalValue,
      holdings,
    };
  },

  /**
   * Fetches available trading pairs from CoinSpot.
   * Uses the public API to get latest coin prices.
   */
  async getPairs(_creds: ExchangeCredentials): Promise<PairsResponse> {
    const res = await fetch(`${BASE_URL}/pubapi/v2/latest`);
    if (!res.ok) throw new Error(`CoinSpot pairs failed: ${res.status}`);

    const data = (await res.json()) as {
      status: string;
      prices: Record<string, { bid: string; ask: string; last: string }>;
    };

    const pairs: PairResponse[] = Object.keys(data.prices ?? {}).map((coin) => {
      const upper = coin.toUpperCase();
      return {
        symbol: `${upper}/AUD`,
        coin: upper,
        coinName: COIN_NAMES[upper] ?? upper,
      };
    });

    return {
      exchange: 'coinspot',
      baseCurrency: 'AUD',
      pairs,
    };
  },

  /**
   * Fetches recent completed orders from CoinSpot.
   * Calls POST /api/ro/my/orders/completed for completed buy/sell history.
   */
  async getOrders(creds: ExchangeCredentials): Promise<OrdersResponse> {
    const data = await signedRequest<{
      status: string;
      buyorders?: Array<{
        id?: string;
        coin: string;
        amount: number;
        rate: number;
        total: number;
        solddate: string;
      }>;
      sellorders?: Array<{
        id?: string;
        coin: string;
        amount: number;
        rate: number;
        total: number;
        solddate: string;
      }>;
    }>('/api/ro/my/orders/completed', creds);

    const orders: OrderResponse[] = [];

    for (const o of data.buyorders ?? []) {
      orders.push({
        orderId: o.id ?? `buy-${o.solddate}`,
        pair: o.coin.toUpperCase(),
        side: 'buy',
        type: 'market',
        size: o.amount,
        price: o.rate,
        total: o.total,
        status: 'filled',
        createdAt: o.solddate,
      });
    }

    for (const o of data.sellorders ?? []) {
      orders.push({
        orderId: o.id ?? `sell-${o.solddate}`,
        pair: o.coin.toUpperCase(),
        side: 'sell',
        type: 'market',
        size: o.amount,
        price: o.rate,
        total: o.total,
        status: 'filled',
        createdAt: o.solddate,
      });
    }

    return { exchange: 'coinspot', orders };
  },

  /**
   * Places a market order on CoinSpot.
   * Uses POST /api/v2/my/buy/now (buy) or /api/v2/my/sell/now (sell).
   * CoinSpot buy requires AUD amount; sell requires coin amount.
   */
  async placeOrder(creds: ExchangeCredentials, params: PlaceOrderParams): Promise<PlaceOrderResult> {
    try {
      const path = params.side === 'buy' ? '/api/v2/my/buy/now' : '/api/v2/my/sell/now';

      const body: Record<string, unknown> = {
        cointype: params.pair,
      };

      if (params.side === 'buy') {
        // CoinSpot buy endpoint requires 'amount' in AUD — caller provides size in coin units.
        // We pass 'amount' as coin quantity and let CoinSpot handle market pricing.
        body.amount = params.size;
        body.amounttype = 'coin';
      } else {
        // CoinSpot sell endpoint requires 'amount' in coin units.
        body.amount = params.size;
      }

      const data = await signedRequest<{
        status?: string;
        id?: string;
        message?: string;
      }>(path, creds, body);

      if (data.status === 'ok') {
        return { status: 'filled', orderId: data.id };
      }

      return { status: 'failed', failReason: data.message ?? 'CoinSpot order rejected' };
    } catch (err) {
      return { status: 'failed', failReason: `CoinSpot order error: ${(err as Error).message}` };
    }
  },
};
