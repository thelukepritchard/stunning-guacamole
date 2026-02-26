import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getBalance } from './routes/get-balance';
import { getPairs } from './routes/get-pairs';
import { placeOrder } from './routes/place-order';
import { listOrders } from './routes/list-orders';
import { cancelOrder } from './routes/cancel-order';
import { jsonResponse } from './utils';

/**
 * Lambda entry-point for the demo exchange. Routes the incoming
 * API Gateway request to the appropriate handler based on HTTP method
 * and resource path.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'GET /demo-exchange/balance':                    return getBalance(event);
    case 'GET /demo-exchange/pairs':                      return getPairs(event);
    case 'POST /demo-exchange/orders':                    return placeOrder(event);
    case 'GET /demo-exchange/orders':                     return listOrders(event);
    case 'DELETE /demo-exchange/orders/{orderId}':        return cancelOrder(event);
    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
}
