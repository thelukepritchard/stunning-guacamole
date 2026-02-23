import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listPortfolios } from './routes/list-portfolios';
import { createPortfolio } from './routes/create-portfolio';
import { getPortfolio } from './routes/get-portfolio';
import { updatePortfolio } from './routes/update-portfolio';
import { deletePortfolio } from './routes/delete-portfolio';

/**
 * Lambda entry-point. Routes the incoming API Gateway request to the
 * appropriate handler based on HTTP method and resource path.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'GET /portfolio':          return listPortfolios(event);
    case 'POST /portfolio':         return createPortfolio(event);
    case 'GET /portfolio/{id}':     return getPortfolio(event);
    case 'PUT /portfolio/{id}':     return updatePortfolio(event);
    case 'DELETE /portfolio/{id}':  return deletePortfolio(event);
    default:
      return { statusCode: 404, body: JSON.stringify({ error: 'Route not found' }) };
  }
}
