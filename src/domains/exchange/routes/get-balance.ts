import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse, DEMO_EXCHANGE_API_URL } from '../utils';
import { BINANCE_TICKER_URL, COIN_NAMES, CURRENCY_NAMES } from '../../shared/types';
import type { BalanceResponse, HoldingEntry } from '../../shared/types';
import { resolveActiveExchange } from '../resolve-exchange';
import { getAdapter } from '../adapters';

/**
 * Fetches the current BTC price from Binance.
 *
 * @returns The BTC price in USD.
 * @throws If Binance returns a non-200 response or an invalid price.
 */
async function fetchBtcPrice(): Promise<number> {
  const res = await fetch(BINANCE_TICKER_URL);
  if (!res.ok) {
    throw new Error(`Binance ticker returned ${res.status}`);
  }
  const data = (await res.json()) as { price: string };
  const price = parseFloat(data.price);
  if (isNaN(price)) {
    throw new Error('Invalid price returned from Binance');
  }
  return price;
}

/**
 * Returns the user's balance with a full holdings breakdown.
 *
 * Resolves the user's active exchange and delegates to the appropriate
 * adapter. For demo mode, fetches the demo exchange balance and BTC price
 * in parallel, then builds a holdings array with computed values.
 *
 * @param event - Cognito-authenticated API Gateway event.
 * @returns Normalised JSON balance response with holdings.
 */
export async function getBalance(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const resolved = await resolveActiveExchange(sub);

  // Real exchange — delegate to adapter
  if (resolved.exchangeId !== 'demo' && resolved.credentials) {
    try {
      const adapter = getAdapter(resolved.exchangeId);
      const balance = await adapter.getBalance(resolved.credentials);

      if (balance.holdings.length === 0) {
        return jsonResponse(200, { ...balance, message: 'No funds found on this exchange' });
      }

      return jsonResponse(200, balance);
    } catch {
      return jsonResponse(501, { error: `${resolved.exchangeId} balance not yet supported — coming soon` });
    }
  }

  // Demo exchange
  const balanceUrl = `${DEMO_EXCHANGE_API_URL}demo-exchange/balance?sub=${encodeURIComponent(sub)}`;

  let balanceRes: Response;
  let btcPrice: number;
  try {
    [balanceRes, btcPrice] = await Promise.all([fetch(balanceUrl), fetchBtcPrice()]);
  } catch {
    return jsonResponse(502, { error: 'Failed to reach demo exchange' });
  }

  if (!balanceRes.ok) {
    const err = await balanceRes.json().catch(() => ({ error: 'Upstream error' }));
    return jsonResponse(balanceRes.status, err);
  }

  const data = (await balanceRes.json()) as { usd: number; btc: number };

  const holdings: HoldingEntry[] = [];
  const currency = 'AUD';

  // Only include base currency if worth at least 1 cent
  if (data.usd >= 0.01) {
    holdings.push({ asset: currency, name: CURRENCY_NAMES[currency] ?? currency, amount: data.usd, price: 1, value: data.usd });
  }

  if (data.btc > 0) {
    const btcValue = data.btc * btcPrice;
    // Only include BTC if worth at least 1 cent
    if (btcValue >= 0.01) {
      holdings.push({ asset: 'BTC', name: COIN_NAMES['BTC']!, amount: data.btc, price: btcPrice, value: btcValue });
    }
  }

  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

  const response: BalanceResponse & { message?: string } = {
    exchange: 'demo',
    currency: 'AUD',
    totalValue,
    holdings,
  };

  if (holdings.length === 0) {
    response.message = 'No funds found on this exchange';
  }

  return jsonResponse(200, response);
}
