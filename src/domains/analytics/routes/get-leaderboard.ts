import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import type { PortfolioRecord, PortfolioPerformanceRecord } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Maximum number of leaderboard entries to return. */
const MAX_LIMIT = 100;

/** Default number of leaderboard entries to return. */
const DEFAULT_LIMIT = 20;

/** Maximum concurrent DynamoDB queries for performance lookups. */
const CONCURRENCY_LIMIT = 25;

/**
 * Processes an array of async tasks with a concurrency limit.
 *
 * @param items - The items to process.
 * @param concurrency - Maximum concurrent tasks.
 * @param fn - Async function to apply to each item.
 * @returns Results in the same order as the input items.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/**
 * Returns the leaderboard of top users ranked by 24-hour P&L.
 *
 * Scans the portfolio table for all users (with minimal projection),
 * fetches each user's latest portfolio performance snapshot using
 * concurrency-limited parallel queries, and returns the top N users
 * sorted by `pnl24h` descending.
 *
 * Query params:
 * - limit: number of entries to return (default: 20, max: 100)
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with leaderboard entries.
 */
export async function getLeaderboard(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const limit = Math.min(
    parseInt(event.queryStringParameters?.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  // Scan portfolio table with minimal projection to reduce data transfer
  const users: PortfolioRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const scan = await ddbDoc.send(new ScanCommand({
      TableName: process.env.PORTFOLIO_TABLE_NAME!,
      ProjectionExpression: '#sub, username',
      ExpressionAttributeNames: { '#sub': 'sub' },
      ExclusiveStartKey: lastKey,
    }));
    users.push(...(scan.Items as PortfolioRecord[] ?? []));
    lastKey = scan.LastEvaluatedKey;
  } while (lastKey);

  // Fetch latest performance snapshot for each user with concurrency control
  const entries = await mapWithConcurrency(users, CONCURRENCY_LIMIT, async (user) => {
    try {
      const result = await ddbDoc.send(new QueryCommand({
        TableName: process.env.PORTFOLIO_PERFORMANCE_TABLE_NAME!,
        KeyConditionExpression: '#sub = :sub',
        ExpressionAttributeNames: { '#sub': 'sub' },
        ExpressionAttributeValues: { ':sub': user.sub },
        ProjectionExpression: 'activeBots, totalNetPnl, pnl24h, #ts',
        ScanIndexForward: false,
        Limit: 1,
      }));

      const perf = result.Items?.[0] as PortfolioPerformanceRecord | undefined;
      if (!perf) return null;

      return {
        username: user.username,
        activeBots: perf.activeBots,
        totalNetPnl: perf.totalNetPnl,
        pnl24h: perf.pnl24h,
        timestamp: perf.timestamp,
      };
    } catch {
      return null;
    }
  });

  // Filter out users with no performance data, sort by 24h P&L descending
  const ranked = entries
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => b.pnl24h - a.pnl24h)
    .slice(0, limit)
    .map((entry, index) => ({ rank: index + 1, ...entry }));

  return jsonResponse(200, { items: ranked });
}
