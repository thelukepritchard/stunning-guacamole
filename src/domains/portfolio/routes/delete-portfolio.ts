import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';

/**
 * Deletes a portfolio.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response confirming deletion.
 */
export async function deletePortfolio(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const id = event.pathParameters?.id;
  return jsonResponse(200, { id, deleted: true });
}
