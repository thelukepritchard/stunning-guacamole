import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';

/**
 * Retrieves a single portfolio by ID.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response containing the portfolio.
 */
export async function getPortfolio(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const id = event.pathParameters?.id;
  return jsonResponse(200, { id, name: 'Growth Portfolio', holdings: [] });
}
