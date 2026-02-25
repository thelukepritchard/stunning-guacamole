import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Period to hours mapping. */
const PERIOD_HOURS: Record<string, number> = {
  '24h': 24,
  '7d': 168,
  '30d': 720,
  'all': 8760,
};

/**
 * Returns portfolio performance (P&L time series) for the authenticated user.
 *
 * Query params:
 * - period: '24h' | '7d' | '30d' | 'all' (default: '7d')
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with portfolio performance snapshots sorted oldest-first.
 */
export async function getPortfolioPerformance(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const period = event.queryStringParameters?.period ?? '7d';
  const hours = PERIOD_HOURS[period];
  if (!hours) return jsonResponse(400, { error: `Invalid period: ${period}` });

  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.PORTFOLIO_PERFORMANCE_TABLE_NAME!,
    KeyConditionExpression: '#sub = :sub AND #ts >= :since',
    ExpressionAttributeNames: { '#sub': 'sub', '#ts': 'timestamp' },
    ExpressionAttributeValues: { ':sub': sub, ':since': since },
    ScanIndexForward: true,
  }));

  return jsonResponse(200, { items: result.Items ?? [] });
}
