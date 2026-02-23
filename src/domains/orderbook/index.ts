import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listOrders } from './routes/list-orders';
import { placeOrder } from './routes/place-order';
import { getOrder } from './routes/get-order';
import { updateOrder } from './routes/update-order';
import { cancelOrder } from './routes/cancel-order';

/**
 * Lambda entry-point. Routes the incoming API Gateway request to the
 * appropriate handler based on HTTP method and resource path.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'GET /orderbook':          return listOrders(event);
    case 'POST /orderbook':         return placeOrder(event);
    case 'GET /orderbook/{id}':     return getOrder(event);
    case 'PUT /orderbook/{id}':     return updateOrder(event);
    case 'DELETE /orderbook/{id}':  return cancelOrder(event);
    default:
      return { statusCode: 404, body: JSON.stringify({ error: 'Route not found' }) };
  }
}
