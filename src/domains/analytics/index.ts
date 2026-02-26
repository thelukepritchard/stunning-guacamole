import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getPortfolioPerformance } from './routes/get-portfolio-performance';
import { getBotPerformance } from './routes/get-bot-performance';
import { getLeaderboard } from './routes/get-leaderboard';
import { getTraderProfile } from './routes/get-trader-profile';
import { jsonResponse } from './utils';

/**
 * Lambda entry-point for the analytics domain. Routes the incoming API Gateway
 * request to the appropriate handler based on HTTP method and resource path.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'GET /analytics/performance':                     return getPortfolioPerformance(event);
    case 'GET /analytics/bots/{botId}/performance':        return getBotPerformance(event);
    case 'GET /analytics/leaderboard':                     return getLeaderboard(event);
    case 'GET /analytics/leaderboard/{username}':          return getTraderProfile(event);
    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
}
