import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getBalance } from './routes/get-balance';
import { getPairs } from './routes/get-pairs';
import { listOrders } from './routes/list-orders';
import { cancelOrder } from './routes/cancel-order';
import { jsonResponse } from './utils';

/**
 * Lambda entry-point for the orderbook domain. Routes the incoming
 * API Gateway request to the appropriate handler based on HTTP method
 * and resource path.
 *
 * The orderbook acts as an exchange proxy — it resolves the user's
 * configured exchange and delegates to the appropriate adapter.
 * Currently all users are routed to the demo exchange.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'GET /orderbook/balance':                 return getBalance(event);
    case 'GET /orderbook/pairs':                   return getPairs(event);
    case 'GET /orderbook/orders':                  return listOrders(event);
    case 'DELETE /orderbook/orders/{orderId}':      return cancelOrder(event);
    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
}
