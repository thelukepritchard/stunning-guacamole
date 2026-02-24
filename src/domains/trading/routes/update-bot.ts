import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Updates an existing bot. Supports updating name, pair, action, status, and query.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with the updated bot attributes.
 */
export async function updateBot(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const botId = event.pathParameters?.botId;
  if (!botId) return jsonResponse(400, { error: 'Missing botId' });

  const body = JSON.parse(event.body ?? '{}');
  const allowedFields = ['name', 'pair', 'action', 'status', 'query'];
  const updates: string[] = [];
  const names: Record<string, string> = { '#sub': 'sub' };
  const values: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      const attrName = `#${field}`;
      const attrValue = `:${field}`;
      updates.push(`${attrName} = ${attrValue}`);
      names[attrName] = field;
      values[attrValue] = body[field];
    }
  }

  if (updates.length === 0) {
    return jsonResponse(400, { error: 'No valid fields to update' });
  }

  // Always update updatedAt
  updates.push('#updatedAt = :updatedAt');
  names['#updatedAt'] = 'updatedAt';
  values[':updatedAt'] = new Date().toISOString();

  try {
    const result = await ddbDoc.send(new UpdateCommand({
      TableName: process.env.BOTS_TABLE_NAME!,
      Key: { sub, botId },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(#sub)',
      ReturnValues: 'ALL_NEW',
    }));

    return jsonResponse(200, result.Attributes);
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return jsonResponse(404, { error: 'Bot not found' });
    }
    throw err;
  }
}
