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

/** Known quote currency suffixes for legacy pair normalization (longest first). */
const KNOWN_QUOTES = ['FDUSD', 'USDT', 'USDC', 'USD', 'AUD', 'EUR', 'BTC', 'ETH', 'BNB'];

/**
 * Normalises a pair/coin parameter into the simple coin ticker format
 * used in the price history table (e.g. `BTC`).
 *
 * Handles multiple input formats for backward compatibility:
 * - `BTC`       — already canonical
 * - `BTC/USDT`  — strip after `/`
 * - `BTC-USDT`  — strip after `-`
 * - `BTCUSDT`   — strip known quote suffixes
 *
 * @param raw - The raw pair/coin string from the URL path parameter.
 * @returns The normalised coin ticker (e.g. `BTC`).
 */
function normalizeCoin(raw: string): string {
  if (raw.includes('/')) return raw.split('/')[0];
  if (raw.includes('-')) return raw.split('-')[0];

  const upper = raw.toUpperCase();
  for (const quote of KNOWN_QUOTES) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return upper.slice(0, -quote.length);
    }
  }

  return raw;
}

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

  // Normalise URL param to coin ticker (e.g. BTC)
  const pair = normalizeCoin(pairParam);

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
