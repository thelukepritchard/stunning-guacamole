import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Returns the authenticated user's portfolio entry.
 *
 * Each user has a single portfolio record created automatically
 * on Cognito sign-up via the post-confirmation trigger.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response containing the user's portfolio.
 */
export async function listPortfolios(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const result = await ddbDoc.send(new GetCommand({
    TableName: process.env.PORTFOLIO_TABLE_NAME!,
    Key: { sub },
  }));

  if (!result.Item) return jsonResponse(404, { error: 'Portfolio not found' });

  return jsonResponse(200, result.Item);
}
