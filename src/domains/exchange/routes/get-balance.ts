import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse, DEMO_EXCHANGE_API_URL } from '../utils';
import { BINANCE_TICKER_URL, COIN_NAMES, CURRENCY_NAMES } from '../../shared/types';
import type { BalanceResponse, HoldingEntry } from '../../shared/types';

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
 * Fetches demo exchange balance and BTC price in parallel, then builds
 * a holdings array with computed values.
 *
 * @param event - Cognito-authenticated API Gateway event.
 * @returns Normalised JSON balance response with holdings.
 */
export async function getBalance(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

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
  holdings.push({ asset: currency, name: CURRENCY_NAMES[currency] ?? currency, amount: data.usd, price: 1, value: data.usd });

  if (data.btc > 0) {
    const btcValue = data.btc * btcPrice;
    holdings.push({ asset: 'BTC', name: COIN_NAMES['BTC']!, amount: data.btc, price: btcPrice, value: btcValue });
  }

  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

  const response: BalanceResponse = {
    exchange: 'demo',
    currency: 'AUD',
    totalValue,
    holdings,
  };

  return jsonResponse(200, response);
}
