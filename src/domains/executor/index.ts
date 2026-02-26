import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listTrades } from './routes/list-trades';
import { listBotTrades } from './routes/list-bot-trades';
import { jsonResponse } from './utils';

/**
 * Lambda entry-point for the executor domain. Routes the incoming API Gateway
 * request to the appropriate handler based on HTTP method and resource path.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'GET /trades':           return listTrades(event);
    case 'GET /trades/{botId}':   return listBotTrades(event);
    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
}
