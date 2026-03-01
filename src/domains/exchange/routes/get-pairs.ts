import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse, DEMO_EXCHANGE_API_URL } from '../utils';
import { COIN_NAMES } from '../../shared/types';
import type { PairsResponse } from '../../shared/types';
import { resolveActiveExchange } from '../resolve-exchange';
import { getAdapter } from '../adapters';

/**
 * Returns available trading pairs filtered to the user's base currency
 * and the platform's accepted coin whitelist.
 *
 * Resolves the user's active exchange and delegates to the appropriate
 * adapter. For demo mode, fetches pairs from the demo exchange.
 *
 * @param event - Cognito-authenticated API Gateway event.
 * @returns Normalised JSON pairs response.
 */
export async function getPairs(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const resolved = await resolveActiveExchange(sub);

  // Real exchange — delegate to adapter
  if (resolved.exchangeId !== 'demo' && resolved.credentials) {
    try {
      const adapter = getAdapter(resolved.exchangeId);
      const pairs = await adapter.getPairs(resolved.credentials);
      return jsonResponse(200, pairs);
    } catch {
      return jsonResponse(501, { error: `${resolved.exchangeId} pairs not yet supported — coming soon` });
    }
  }

  // Demo exchange
  const url = `${DEMO_EXCHANGE_API_URL}demo-exchange/pairs`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return jsonResponse(502, { error: 'Failed to reach demo exchange' });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upstream error' }));
    return jsonResponse(res.status, err);
  }

  const data = (await res.json()) as { coins: Array<{ ticker: string; name: string }> };

  const response: PairsResponse = {
    exchange: 'demo',
    baseCurrency: 'AUD',
    pairs: data.coins.map(c => ({
      symbol: c.ticker,
      coin: c.ticker,
      coinName: COIN_NAMES[c.ticker] ?? c.name,
    })),
  };

  return jsonResponse(200, response);
}
