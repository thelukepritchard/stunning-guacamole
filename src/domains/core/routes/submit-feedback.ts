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
export async function submitFeedback(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { category, message } = JSON.parse(event.body ?? '{}');
  const email: string = event.requestContext.authorizer?.claims?.email ?? 'unknown';

  const item = {
    id: randomUUID(),
    email,
    category: category ?? 'general',
    message: message ?? '',
    createdAt: new Date().toISOString(),
  };

  await ddbDoc.send(new PutCommand({
    TableName: process.env.FEEDBACK_TABLE_NAME!,
    Item: item,
  }));

  return jsonResponse(201, item);
}
