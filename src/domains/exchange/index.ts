import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getBalance } from './routes/get-balance';
import { getPairs } from './routes/get-pairs';
import { listOrders } from './routes/list-orders';
import { cancelOrder } from './routes/cancel-order';
import { createConnection } from './routes/create-connection';
import { listConnections } from './routes/list-connections';
import { deleteConnection } from './routes/delete-connection';
import { setActiveExchange } from './routes/set-active-exchange';
import { getActiveExchange } from './routes/get-active-exchange';
import { jsonResponse } from './utils';

/**
 * Lambda entry-point for the exchange domain. Routes the incoming
 * API Gateway request to the appropriate handler based on HTTP method
 * and resource path.
 *
 * The exchange acts as an exchange proxy — it resolves the user's
 * configured exchange and delegates to the appropriate adapter.
 * Also handles exchange connection CRUD and active exchange preference.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'GET /exchange/balance':                           return getBalance(event);
    case 'GET /exchange/pairs':                             return getPairs(event);
    case 'GET /exchange/orders':                            return listOrders(event);
    case 'DELETE /exchange/orders/{orderId}':                return cancelOrder(event);
    case 'POST /exchange/connections':                       return createConnection(event);
    case 'GET /exchange/connections':                        return listConnections(event);
    case 'DELETE /exchange/connections/{connectionId}':       return deleteConnection(event);
    case 'PUT /exchange/active':                             return setActiveExchange(event);
    case 'GET /exchange/active':                             return getActiveExchange(event);
    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
}
