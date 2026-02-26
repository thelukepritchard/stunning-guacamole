import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Lists trade signals for the authenticated user, newest first.
 *
 * Supports optional `?limit=N` query parameter (default 50).
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response containing the list of trades.
 */
export async function listTrades(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const limit = parseInt(event.queryStringParameters?.limit ?? '50', 10);

  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.TRADES_TABLE_NAME!,
    IndexName: 'sub-index',
    KeyConditionExpression: '#sub = :sub',
    ExpressionAttributeNames: { '#sub': 'sub' },
    ExpressionAttributeValues: { ':sub': sub },
    ScanIndexForward: false,
    Limit: limit,
  }));

  return jsonResponse(200, { items: result.Items ?? [] });
}
