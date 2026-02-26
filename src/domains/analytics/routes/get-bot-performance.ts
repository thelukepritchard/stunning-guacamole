import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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
 * Returns bot performance (P&L time series) for a specific bot.
 *
 * Verifies the bot belongs to the authenticated user before returning data.
 * Query params:
 * - period: '24h' | '7d' | '30d' | 'all' (default: '7d')
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with performance snapshots sorted oldest-first.
 */
export async function getBotPerformance(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const botId = event.pathParameters?.botId;
  if (!botId) return jsonResponse(400, { error: 'Missing botId' });

  // Verify bot belongs to user
  const botResult = await ddbDoc.send(new GetCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub, botId },
  }));

  if (!botResult.Item) return jsonResponse(404, { error: 'Bot not found' });

  const period = event.queryStringParameters?.period ?? '7d';
  const hours = PERIOD_HOURS[period];
  if (!hours) return jsonResponse(400, { error: `Invalid period: ${period}` });

  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.BOT_PERFORMANCE_TABLE_NAME!,
    KeyConditionExpression: 'botId = :botId AND #ts >= :since',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: { ':botId': botId, ':since': since },
    ScanIndexForward: true,
  }));

  return jsonResponse(200, { items: result.Items ?? [] });
}
