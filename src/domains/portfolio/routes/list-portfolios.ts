import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';

/**
 * Lists all portfolios.
 *
 * @param _event - The incoming API Gateway event (unused).
 * @returns A JSON response containing the list of portfolios.
 */
export async function listPortfolios(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return jsonResponse(200, {
    items: [
      { id: 'p-001', name: 'Growth Portfolio' },
      { id: 'p-002', name: 'Income Portfolio' },
    ],
  });
}
