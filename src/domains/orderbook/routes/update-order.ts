import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';

/**
 * Updates an order.
 *
 * @param event - The incoming API Gateway event containing the updated data.
 * @returns A JSON response containing the updated order.
 */
export async function updateOrder(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const id = event.pathParameters?.id;
  const body = JSON.parse(event.body ?? '{}');
  return jsonResponse(200, { id, status: body.status ?? 'updated' });
}
