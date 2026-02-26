import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createBot } from './routes/create-bot';
import { listBots } from './routes/list-bots';
import { getBot } from './routes/get-bot';
import { updateBot } from './routes/update-bot';
import { deleteBot } from './routes/delete-bot';
import { getSettings } from './routes/get-settings';
import { updateSettings } from './routes/update-settings';
import { getExchangeOptions } from './routes/get-exchange-options';

/**
 * Lambda entry-point for the bots domain. Routes the incoming API Gateway
 * request to the appropriate handler based on HTTP method and resource path.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'GET /bots':                             return listBots(event);
    case 'POST /bots':                            return createBot(event);
    case 'GET /bots/{botId}':                     return getBot(event);
    case 'PUT /bots/{botId}':                     return updateBot(event);
    case 'DELETE /bots/{botId}':                  return deleteBot(event);
    case 'GET /settings':                         return getSettings(event);
    case 'PUT /settings':                         return updateSettings(event);
    case 'GET /settings/exchange-options':         return getExchangeOptions(event);
    default:
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        },
        body: JSON.stringify({ error: 'Route not found' }),
      };
  }
}
