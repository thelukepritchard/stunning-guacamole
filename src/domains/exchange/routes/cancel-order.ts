import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse, DEMO_EXCHANGE_API_URL } from '../utils';
import { resolveActiveExchange } from '../resolve-exchange';

/**
 * Cancels a pending order on the user's active exchange.
 *
 * Resolves the user's active exchange. For real exchanges, cancellation
 * is not yet supported (Phase 2). For demo mode, proxies the request to
 * the demo exchange.
 *
 * @param event - Cognito-authenticated API Gateway event with `orderId` path param.
 * @returns JSON response with the cancellation result.
 */
export async function cancelOrder(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const orderId = event.pathParameters?.orderId;
  if (!orderId) {
    return jsonResponse(400, { error: 'Missing required path parameter: orderId' });
  }

  const resolved = await resolveActiveExchange(sub);

  // Real exchange — not yet supported
  if (resolved.exchangeId !== 'demo') {
    return jsonResponse(501, { error: `${resolved.exchangeId} order cancellation not yet supported — coming soon` });
  }

  // Demo exchange
  const url = `${DEMO_EXCHANGE_API_URL}demo-exchange/orders/${encodeURIComponent(orderId)}?sub=${encodeURIComponent(sub)}`;

  let res: Response;
  try {
    res = await fetch(url, { method: 'DELETE' });
  } catch {
    return jsonResponse(502, { error: 'Failed to reach demo exchange' });
  }

  const data = await res.json().catch(() => ({ error: 'Upstream error' }));

  return jsonResponse(res.status, data);
}
