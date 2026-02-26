import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import type { PortfolioRecord, PortfolioPerformanceRecord } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Period to hours mapping for performance history. */
const PERIOD_HOURS: Record<string, number> = {
  '24h': 24,
  '7d': 168,
  '30d': 720,
};

/**
 * Returns the public trader profile for a given username.
 *
 * Looks up the user by username via the `username-index` GSI on the
 * portfolio table, then fetches their performance snapshots for the
 * requested period. Returns 404 if the user is not found.
 *
 * Path params:
 * - username: the trader's public username
 *
 * Query params:
 * - period: '24h' | '7d' | '30d' (default: '7d')
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with the trader's public profile.
 */
export async function getTraderProfile(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const username = event.pathParameters?.username;
  if (!username) return jsonResponse(400, { error: 'Missing username' });
  if (username.length > 50) return jsonResponse(400, { error: 'Invalid username' });

  const period = event.queryStringParameters?.period ?? '7d';
  const hours = PERIOD_HOURS[period];
  if (!hours) return jsonResponse(400, { error: `Invalid period: ${period}` });

  // Look up user by username via GSI
  const userResult = await ddbDoc.send(new QueryCommand({
    TableName: process.env.PORTFOLIO_TABLE_NAME!,
    IndexName: 'username-index',
    KeyConditionExpression: '#username = :username',
    ExpressionAttributeNames: { '#username': 'username' },
    ExpressionAttributeValues: { ':username': username },
    Limit: 1,
  }));

  const user = userResult.Items?.[0] as PortfolioRecord | undefined;
  if (!user) return jsonResponse(404, { error: 'Trader not found' });

  // Fetch performance snapshots for the requested period
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const perfResult = await ddbDoc.send(new QueryCommand({
    TableName: process.env.PORTFOLIO_PERFORMANCE_TABLE_NAME!,
    KeyConditionExpression: '#sub = :sub AND #ts >= :since',
    ExpressionAttributeNames: { '#sub': 'sub', '#ts': 'timestamp' },
    ExpressionAttributeValues: { ':sub': user.sub, ':since': since },
    ScanIndexForward: true,
  }));

  const snapshots = (perfResult.Items ?? []) as PortfolioPerformanceRecord[];

  // Build summary from the latest snapshot
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  return jsonResponse(200, {
    username: user.username,
    createdAt: user.createdAt,
    summary: latest
      ? {
          activeBots: latest.activeBots,
          totalNetPnl: latest.totalNetPnl,
          totalRealisedPnl: latest.totalRealisedPnl,
          totalUnrealisedPnl: latest.totalUnrealisedPnl,
          pnl24h: latest.pnl24h,
          lastUpdated: latest.timestamp,
        }
      : null,
    performance: snapshots.map((s) => ({
      timestamp: s.timestamp,
      totalNetPnl: s.totalNetPnl,
      totalRealisedPnl: s.totalRealisedPnl,
      totalUnrealisedPnl: s.totalUnrealisedPnl,
      pnl24h: s.pnl24h,
      activeBots: s.activeBots,
    })),
  });
}
