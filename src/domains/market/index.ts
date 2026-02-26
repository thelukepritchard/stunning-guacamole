import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getPriceHistory } from './routes/get-price-history';
import { jsonResponse } from './utils';

/**
 * Lambda entry-point for the market domain. Routes the incoming API Gateway
 * request to the appropriate handler based on HTTP method and resource path.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'GET /market/prices/{pair}':  return getPriceHistory(event);
    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
}
