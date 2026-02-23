import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';

/**
 * Places a new order.
 *
 * @param event - The incoming API Gateway event containing the order data.
 * @returns A JSON response containing the created order.
 */
export async function placeOrder(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body ?? '{}');
  return jsonResponse(201, {
    id: 'o-new',
    symbol: body.symbol ?? 'UNKNOWN',
    side: body.side ?? 'buy',
    quantity: body.quantity ?? 0,
    status: 'pending',
  });
}
