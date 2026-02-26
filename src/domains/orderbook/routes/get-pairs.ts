import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse, DEMO_EXCHANGE_API_URL } from '../utils';
import { COIN_NAMES } from '../types';
import type { PairsResponse } from '../types';

/**
 * Returns available trading pairs filtered to the user's base currency
 * and the platform's accepted coin whitelist.
 * Currently all users are routed to the demo exchange.
 *
 * @param event - Cognito-authenticated API Gateway event.
 * @returns Normalised JSON pairs response.
 */
export async function getPairs(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

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

  const data = (await res.json()) as { pairs: Array<{ symbol: string; base: string; quote: string }> };

  const response: PairsResponse = {
    exchange: 'demo',
    baseCurrency: 'USD',
    pairs: data.pairs.map(p => ({
      symbol: p.symbol,
      coin: p.base,
      coinName: COIN_NAMES[p.base] ?? p.base,
    })),
  };

  return jsonResponse(200, response);
}
