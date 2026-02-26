import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse, DEMO_EXCHANGE_API_URL } from '../utils';

/**
 * Cancels a pending order on the user's configured exchange.
 * Currently all users are routed to the demo exchange.
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
