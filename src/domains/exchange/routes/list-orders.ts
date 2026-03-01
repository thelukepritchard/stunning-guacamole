import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse, DEMO_EXCHANGE_API_URL } from '../utils';
import type { OrdersResponse, OrderResponse } from '../../shared/types';
import { resolveActiveExchange } from '../resolve-exchange';
import { getAdapter } from '../adapters';
import { sigv4Fetch } from '../../shared/sigv4-fetch';

/**
 * Returns the user's orders from their active exchange.
 *
 * Resolves the user's active exchange and delegates to the appropriate
 * adapter. For demo mode, fetches orders from the demo exchange.
 *
 * @param event - Cognito-authenticated API Gateway event.
 * @returns Normalised JSON orders response.
 */
export async function listOrders(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const resolved = await resolveActiveExchange(sub);

  // Real exchange — delegate to adapter
  if (resolved.exchangeId !== 'demo' && resolved.credentials) {
    try {
      const adapter = getAdapter(resolved.exchangeId);
      const orders = await adapter.getOrders(resolved.credentials);
      return jsonResponse(200, orders);
    } catch {
      return jsonResponse(501, { error: `${resolved.exchangeId} orders not yet supported — coming soon` });
    }
  }

  // Demo exchange
  const url = `${DEMO_EXCHANGE_API_URL}demo-exchange/orders?sub=${encodeURIComponent(sub)}`;

  let res: Response;
  try {
    res = await sigv4Fetch(url);
  } catch {
    return jsonResponse(502, { error: 'Failed to reach demo exchange' });
  }

  if (!res.ok) {
    console.error(`Demo exchange orders error: ${res.status}`);
    return jsonResponse(502, { error: 'Failed to fetch orders from demo exchange' });
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
