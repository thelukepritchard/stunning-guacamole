import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';

/**
 * Retrieves a single order by ID.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response containing the order.
 */
export async function getOrder(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const id = event.pathParameters?.id;
  return jsonResponse(200, { id, symbol: 'AAPL', side: 'buy', quantity: 10, status: 'filled' });
}
