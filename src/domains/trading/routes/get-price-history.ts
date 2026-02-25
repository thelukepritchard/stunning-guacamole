import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Period to hours mapping. */
const PERIOD_HOURS: Record<string, number> = {
  '1h': 1,
  '6h': 6,
  '24h': 24,
  '7d': 168,
  '30d': 720,
};

/**
 * Returns price history for a trading pair within a time period.
 *
 * Query params:
 * - period: '1h' | '6h' | '24h' | '7d' | '30d' (default: '24h')
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with price history items sorted oldest-first.
 */
export async function getPriceHistory(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const pairParam = event.pathParameters?.pair;
  if (!pairParam) return jsonResponse(400, { error: 'Missing pair' });

  // Convert URL param (BTC-USDT) to DynamoDB key (BTC/USDT)
  const pair = pairParam.replace('-', '/');

  const period = event.queryStringParameters?.period ?? '24h';
  const hours = PERIOD_HOURS[period];
  if (!hours) return jsonResponse(400, { error: `Invalid period: ${period}` });

  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.PRICE_HISTORY_TABLE_NAME!,
    KeyConditionExpression: '#pair = :pair AND #ts >= :since',
    ExpressionAttributeNames: { '#pair': 'pair', '#ts': 'timestamp' },
    ExpressionAttributeValues: { ':pair': pair, ':since': since },
    ScanIndexForward: true,
  }));

  return jsonResponse(200, { items: result.Items ?? [] });
}
