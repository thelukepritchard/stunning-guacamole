import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import type { ExchangeConnectionRecord, ExchangeConnectionResponse } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Lists all exchange connections for the authenticated user.
 *
 * Queries all records for the user's sub and filters out the ACTIVE
 * preference record, returning only real connection records.
 *
 * @param event - Cognito-authenticated API Gateway event.
 * @returns 200 with an array of exchange connection responses.
 */
export async function listConnections(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.CONNECTIONS_TABLE_NAME!,
    KeyConditionExpression: '#sub = :sub',
    ExpressionAttributeNames: { '#sub': 'sub' },
    ExpressionAttributeValues: { ':sub': sub },
  }));

  const items = (result.Items ?? []) as ExchangeConnectionRecord[];

  const connections: ExchangeConnectionResponse[] = items
    .filter((item) => item.connectionId !== 'ACTIVE')
    .map((item) => ({
      exchangeId: item.exchangeId,
      baseCurrency: item.baseCurrency,
      maskedApiKey: item.maskedApiKey,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

  return jsonResponse(200, { connections });
}
