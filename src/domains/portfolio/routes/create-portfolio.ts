import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';

/**
 * Creates a new portfolio.
 *
 * @param event - The incoming API Gateway event containing the portfolio data.
 * @returns A JSON response containing the created portfolio.
 */
export async function createPortfolio(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body ?? '{}');
  return jsonResponse(201, { id: 'p-new', name: body.name ?? 'Untitled' });
}
