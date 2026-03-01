import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Submits user feedback to the DynamoDB feedback table.
 *
 * Expects a JSON body with `category` and `message` fields.
 * The user email is extracted from the Cognito authorizer claims.
 *
 * @param event - The incoming API Gateway event.
 * @returns A 201 JSON response with the created feedback item.
 */
/** Allowed feedback categories. */
const VALID_CATEGORIES = ['general', 'bug', 'feature', 'other'] as const;

/** Maximum feedback message length. */
const MAX_MESSAGE_LENGTH = 5000;

export async function submitFeedback(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const { category, message } = body;
  const email: string = event.requestContext.authorizer?.claims?.email ?? 'unknown';

  const resolvedCategory = typeof category === 'string' && (VALID_CATEGORIES as readonly string[]).includes(category)
    ? category
    : 'general';

  const resolvedMessage = typeof message === 'string' ? message.slice(0, MAX_MESSAGE_LENGTH) : '';
  if (!resolvedMessage) {
    return jsonResponse(400, { error: 'Message is required' });
  }

  const item = {
    id: randomUUID(),
    email,
    category: resolvedCategory,
    message: resolvedMessage,
    createdAt: new Date().toISOString(),
  };

  await ddbDoc.send(new PutCommand({
    TableName: process.env.FEEDBACK_TABLE_NAME!,
    Item: item,
  }));

  return jsonResponse(201, item);
}
