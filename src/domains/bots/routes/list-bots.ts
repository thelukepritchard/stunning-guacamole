import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Lists all bots belonging to the authenticated user.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response containing the list of bots.
 */
export async function listBots(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    KeyConditionExpression: '#sub = :sub',
    ExpressionAttributeNames: { '#sub': 'sub' },
    ExpressionAttributeValues: { ':sub': sub },
  }));

  return jsonResponse(200, { items: result.Items ?? [] });
}
