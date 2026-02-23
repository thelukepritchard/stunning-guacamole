import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';

/**
 * Updates a portfolio.
 *
 * @param event - The incoming API Gateway event containing the updated data.
 * @returns A JSON response containing the updated portfolio.
 */
export async function updatePortfolio(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const id = event.pathParameters?.id;
  const body = JSON.parse(event.body ?? '{}');
  return jsonResponse(200, { id, name: body.name ?? 'Updated Portfolio' });
}
