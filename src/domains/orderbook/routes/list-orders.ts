import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';

/**
 * Lists all orders.
 *
 * @param _event - The incoming API Gateway event (unused).
 * @returns A JSON response containing the list of orders.
 */
export async function listOrders(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return jsonResponse(200, {
    items: [
      { id: 'o-001', symbol: 'AAPL', side: 'buy', quantity: 10, status: 'filled' },
      { id: 'o-002', symbol: 'TSLA', side: 'sell', quantity: 5, status: 'pending' },
    ],
  });
}
