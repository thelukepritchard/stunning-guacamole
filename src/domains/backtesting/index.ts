import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { submitBacktest } from './routes/submit-backtest';
import { listBacktests } from './routes/list-backtests';
import { getLatestBacktest } from './routes/get-latest-backtest';
import { getBacktest } from './routes/get-backtest';
import { jsonResponse } from './utils';

/**
 * Lambda entry-point for the backtesting domain. Routes the incoming API Gateway
 * request to the appropriate handler based on HTTP method and resource path.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'POST /backtests/{botId}':                    return submitBacktest(event);
    case 'GET /backtests/{botId}':                     return listBacktests(event);
    case 'GET /backtests/{botId}/latest':              return getLatestBacktest(event);
    case 'GET /backtests/{botId}/{backtestId}':        return getBacktest(event);
    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
}
