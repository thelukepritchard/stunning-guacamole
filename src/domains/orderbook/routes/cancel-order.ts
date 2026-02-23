import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';

/**
 * Cancels an order.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response confirming cancellation.
 */
export async function cancelOrder(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const id = event.pathParameters?.id;
  return jsonResponse(200, { id, status: 'cancelled' });
}
