import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createBot } from './routes/create-bot';
import { listBots } from './routes/list-bots';
import { getBot } from './routes/get-bot';
import { updateBot } from './routes/update-bot';
import { deleteBot } from './routes/delete-bot';
import { listTrades } from './routes/list-trades';
import { listBotTrades } from './routes/list-bot-trades';

/**
 * Lambda entry-point for the trading domain. Routes the incoming API Gateway
 * request to the appropriate handler based on HTTP method and resource path.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'GET /trading/bots':             return listBots(event);
    case 'POST /trading/bots':            return createBot(event);
    case 'GET /trading/bots/{botId}':     return getBot(event);
    case 'PUT /trading/bots/{botId}':     return updateBot(event);
    case 'DELETE /trading/bots/{botId}':  return deleteBot(event);
    case 'GET /trading/trades':           return listTrades(event);
    case 'GET /trading/trades/{botId}':   return listBotTrades(event);
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
