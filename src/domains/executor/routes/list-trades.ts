import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Lists trade signals for the authenticated user, newest first.
 *
 * Supports optional `?limit=N` (default 50) and `?nextToken=<token>` for cursor-based pagination.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response containing the list of trades and an optional nextToken.
 */
export async function listTrades(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const limit = parseInt(event.queryStringParameters?.limit ?? '50', 10);
  const nextTokenParam = event.queryStringParameters?.nextToken;

  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (nextTokenParam) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(nextTokenParam, 'base64url').toString('utf-8'));
    } catch {
      return jsonResponse(400, { error: 'Invalid nextToken' });
    }
  }

  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.TRADES_TABLE_NAME!,
    IndexName: 'sub-index',
    KeyConditionExpression: '#sub = :sub',
    ExpressionAttributeNames: { '#sub': 'sub' },
    ExpressionAttributeValues: { ':sub': sub },
    ScanIndexForward: false,
    Limit: limit,
    ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
  }));

  const nextToken = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
    : undefined;

  return jsonResponse(200, { items: result.Items ?? [], ...(nextToken && { nextToken }) });
}
