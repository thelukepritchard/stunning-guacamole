import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse, DEMO_EXCHANGE_API_URL } from '../utils';
import type { OrdersResponse, OrderResponse } from '../types';

/**
 * Returns the user's orders from their configured exchange.
 * Currently all users are routed to the demo exchange.
 *
 * @param event - Cognito-authenticated API Gateway event.
 * @returns Normalised JSON orders response.
 */
export async function listOrders(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const url = `${DEMO_EXCHANGE_API_URL}demo-exchange/orders?sub=${encodeURIComponent(sub)}`;

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

  const data = (await res.json()) as {
    orders: Array<{
      orderId: string;
      pair: string;
      side: string;
      type: string;
      size: number;
      executedPrice: number;
      total: number;
      status: string;
      createdAt: string;
    }>;
  };

  const response: OrdersResponse = {
    exchange: 'demo',
    orders: data.orders.map((o): OrderResponse => ({
      orderId: o.orderId,
      pair: o.pair,
      side: o.side,
      type: o.type,
      size: o.size,
      price: o.executedPrice,
      total: o.total,
      status: o.status,
      createdAt: o.createdAt,
    })),
  };

  return jsonResponse(200, response);
}
