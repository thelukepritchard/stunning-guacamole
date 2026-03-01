import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Lists all bots belonging to the authenticated user.
 *
 * Supports optional `?exchangeId=` query parameter to filter bots by exchange.
 * When filtering by 'demo', also matches legacy bots with no exchangeId attribute.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response containing the list of bots.
 */
export async function listBots(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const exchangeId = event.queryStringParameters?.exchangeId;

  const names: Record<string, string> = { '#sub': 'sub' };
  const values: Record<string, unknown> = { ':sub': sub };

  let filterExpression: string | undefined;

  if (exchangeId) {
    names['#exchangeId'] = 'exchangeId';
    values[':exchangeId'] = exchangeId;

    if (exchangeId === 'demo') {
      // Legacy bots have no exchangeId — match both missing and explicit 'demo'
      filterExpression = '(attribute_not_exists(#exchangeId) OR #exchangeId = :exchangeId)';
    } else {
      filterExpression = '#exchangeId = :exchangeId';
    }
  }

  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    KeyConditionExpression: '#sub = :sub',
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ...(filterExpression && { FilterExpression: filterExpression }),
  }));

  return jsonResponse(200, { items: result.Items ?? [] });
}
