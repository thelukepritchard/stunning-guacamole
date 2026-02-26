import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse, DEMO_EXCHANGE_API_URL } from '../utils';
import type { BalanceResponse } from '../../shared/types';

/**
 * Returns the user's available balance in their configured base currency.
 * Currently all users are routed to the demo exchange.
 *
 * @param event - Cognito-authenticated API Gateway event.
 * @returns Normalised JSON balance response.
 */
export async function getBalance(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const url = `${DEMO_EXCHANGE_API_URL}demo-exchange/balance?sub=${encodeURIComponent(sub)}`;

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

  const data = (await res.json()) as { usd: number; btc: number };

  const response: BalanceResponse = {
    exchange: 'demo',
    currency: 'USD',
    available: data.usd,
  };

  return jsonResponse(200, response);
}
