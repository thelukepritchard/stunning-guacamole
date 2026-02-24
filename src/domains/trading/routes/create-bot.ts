import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import type { BotRecord } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Creates a new trading bot.
 *
 * Expects a JSON body with `name`, `pair`, `action`, and `query` fields.
 * The user sub is extracted from the Cognito authorizer claims.
 *
 * @param event - The incoming API Gateway event.
 * @returns A 201 JSON response with the created bot record.
 */
export async function createBot(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const { name, pair, action, query } = JSON.parse(event.body ?? '{}');

  if (!name || !pair || !action || !query) {
    return jsonResponse(400, { error: 'Missing required fields: name, pair, action, query' });
  }

  const now = new Date().toISOString();
  const item: BotRecord = {
    sub,
    botId: randomUUID(),
    name,
    pair,
    action,
    status: 'draft',
    query,
    createdAt: now,
    updatedAt: now,
  };

  await ddbDoc.send(new PutCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Item: item,
  }));

  return jsonResponse(201, item);
}
