import type { PostConfirmationConfirmSignUpTriggerEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { PortfolioRecord } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Cognito post-confirmation trigger that creates a portfolio entry
 * for newly confirmed users.
 *
 * Writes a record to the portfolio DynamoDB table with the user's
 * Cognito `sub` as the partition key. Uses a conditional write to
 * ensure idempotency (duplicate triggers won't overwrite).
 *
 * @param event - The Cognito post-confirmation trigger event.
 * @returns The event object (required by Cognito triggers).
 */
export async function handler(
  event: PostConfirmationConfirmSignUpTriggerEvent,
): Promise<PostConfirmationConfirmSignUpTriggerEvent> {
  const sub = event.request.userAttributes.sub;
  const email = event.request.userAttributes.email ?? '';

  const record: PortfolioRecord = {
    sub,
    email,
    createdAt: new Date().toISOString(),
  };

  try {
    await ddbDoc.send(new PutCommand({
      TableName: process.env.PORTFOLIO_TABLE_NAME!,
      Item: record,
      ConditionExpression: 'attribute_not_exists(#sub)',
      ExpressionAttributeNames: { '#sub': 'sub' },
    }));
    console.log(`Created portfolio entry for user ${sub}`);
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      console.log(`Portfolio entry already exists for user ${sub} — skipping`);
    } else {
      throw err;
    }
  }

  return event;
}
