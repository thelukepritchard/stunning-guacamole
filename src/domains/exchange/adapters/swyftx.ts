import type { BalanceResponse, PairsResponse, OrdersResponse, HoldingEntry, PairResponse, OrderResponse } from '../../shared/types';
import type { ExchangeAdapter, ExchangeCredentials, PlaceOrderParams, PlaceOrderResult } from './types';
import { fetchWithTimeout } from '../../shared/fetch-utils';

const BASE_URL = 'https://api.swyftx.com.au';

/** Cached Swyftx auth token with expiry. */
interface TokenCache {
  token: string;
  expiresAt: number;
}

/** Module-level token cache keyed by API key hash (last 8 chars). */
const tokenCache = new Map<string, TokenCache>();

/** Token cache TTL (25 minutes — Swyftx tokens last 30 min). */
const TOKEN_TTL_MS = 25 * 60 * 1000;

/**
 * Obtains a Bearer access token from the Swyftx auth refresh endpoint.
 * Caches the token for 25 minutes to avoid re-authenticating on every call.
 *
 * @param apiKey - The Swyftx API key.
 * @returns The access token string.
 * @throws If authentication fails.
 */
async function authenticate(apiKey: string): Promise<string> {
  const cacheKey = apiKey.slice(-8);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const res = await fetchWithTimeout(`${BASE_URL}/auth/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });

  if (!res.ok) throw new Error(`Swyftx auth failed: ${res.status}`);

  const data = (await res.json()) as { accessToken?: string };
  if (!data.accessToken) throw new Error('Swyftx auth returned no access token');

  tokenCache.set(cacheKey, { token: data.accessToken, expiresAt: Date.now() + TOKEN_TTL_MS });
  return data.accessToken;
}

/**
 * Swyftx exchange adapter.
 *
 * Authentication: POST /auth/refresh/ with API key to obtain a Bearer token,
 * then use the token in subsequent requests via `Authorization: Bearer {token}`.
 */
export const swyftxAdapter: ExchangeAdapter = {
  /**
   * Validates credentials by obtaining an access token then calling /user/.
   * A 200 response from /user/ confirms the key is valid.
   */
  async validateCredentials(creds: ExchangeCredentials): Promise<boolean> {
    try {
      const token = await authenticate(creds.apiKey);

      const userRes = await fetchWithTimeout(`${BASE_URL}/user/`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return userRes.ok;
    } catch {
      return false;
    }
  },

  /**
   * Fetches the account balance from Swyftx.
   * Authenticates, then calls GET /user/balance/ to retrieve all asset balances.
   */
  async getBalance(creds: ExchangeCredentials): Promise<BalanceResponse> {
    const token = await authenticate(creds.apiKey);

    const res = await fetchWithTimeout(`${BASE_URL}/user/balance/`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new Error(`Swyftx balance failed: ${res.status}`);

    const data = (await res.json()) as Array<{
      assetId: number;
      name?: string;
      code?: string;
      availableBalance: string;
    }>;

    // Fetch asset info to map assetId to ticker/name
    const assetsRes = await fetchWithTimeout(`${BASE_URL}/markets/info/basic/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const assets = assetsRes.ok
      ? (await assetsRes.json()) as Array<{ id: number; code: string; name: string; sell: string }>
      : [];

    const assetMap = new Map(assets.map((a) => [a.id, a]));

    const holdings: HoldingEntry[] = [];
    let totalValue = 0;

    for (const bal of data) {
      const amount = parseFloat(bal.availableBalance);
      if (amount <= 0) continue;

      const asset = assetMap.get(bal.assetId);
      const ticker = asset?.code ?? bal.code ?? String(bal.assetId);
      const name = asset?.name ?? bal.name ?? ticker;
      const price = asset?.sell ? parseFloat(asset.sell) : 0;
      const value = ticker === creds.baseCurrency ? amount : amount * price;

      // Skip holdings worth less than 1 cent
      if (value < 0.01) continue;

      holdings.push({ asset: ticker, name, amount, price, value });
      totalValue += value;
    }

    return {
      exchange: 'swyftx',
      currency: creds.baseCurrency,
      totalValue,
      holdings,
    };
  },

  /**
   * Fetches available trading pairs from Swyftx.
   * Calls GET /markets/info/basic/ and filters by base currency.
   */
  async getPairs(creds: ExchangeCredentials): Promise<PairsResponse> {
    const token = await authenticate(creds.apiKey);

    const res = await fetchWithTimeout(`${BASE_URL}/markets/info/basic/`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new Error(`Swyftx pairs failed: ${res.status}`);

    const data = (await res.json()) as Array<{
      code: string;
      name: string;
      tradable: boolean;
    }>;

    const pairs: PairResponse[] = data
      .filter((a) => a.tradable)
      .map((a) => ({
        symbol: `${a.code}/${creds.baseCurrency}`,
        coin: a.code,
        coinName: a.name,
      }));

    return {
      exchange: 'swyftx',
      baseCurrency: creds.baseCurrency,
      pairs,
    };
  },

  /**
   * Fetches recent orders from Swyftx.
   * Calls GET /history/all/ for completed order history.
   */
  async getOrders(creds: ExchangeCredentials): Promise<OrdersResponse> {
    const token = await authenticate(creds.apiKey);

    const res = await fetchWithTimeout(`${BASE_URL}/history/all/`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new Error(`Swyftx orders failed: ${res.status}`);

    const data = (await res.json()) as Array<{
      orderId: string;
      asset_code?: string;
      orderType: string;
      amount: string;
      rate: string;
      total: string;
      status: string;
      created_at: string;
    }>;

    const orders: OrderResponse[] = data.map((o) => ({
      orderId: o.orderId,
      pair: o.asset_code ?? 'UNKNOWN',
      side: o.orderType === '1' ? 'buy' : 'sell',
      type: 'market',
      size: parseFloat(o.amount),
      price: parseFloat(o.rate),
      total: parseFloat(o.total),
      status: o.status,
      createdAt: o.created_at,
    }));

    return { exchange: 'swyftx', orders };
  },

  /**
   * Places a market order on Swyftx.
   * Authenticates, then POST /orders/ with market order parameters.
   */
  async placeOrder(creds: ExchangeCredentials, params: PlaceOrderParams): Promise<PlaceOrderResult> {
    try {
      const token = await authenticate(creds.apiKey);

      const res = await fetchWithTimeout(`${BASE_URL}/orders/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          primary: params.pair,
          secondary: creds.baseCurrency,
          assetQuantity: String(params.size),
          orderType: 1,
          trigger: params.side === 'buy' ? 'buy' : 'sell',
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        return { status: 'failed', failReason: `Swyftx order failed (${res.status}): ${errBody}` };
      }

      const data = (await res.json()) as { orderId?: string; order_id?: string };
      return { status: 'filled', orderId: data.orderId ?? data.order_id ?? undefined };
    } catch (err) {
      return { status: 'failed', failReason: `Swyftx order error: ${(err as Error).message}` };
    }
  },
};
