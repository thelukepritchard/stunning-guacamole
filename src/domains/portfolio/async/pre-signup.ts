import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Minimum username length. */
const MIN_LENGTH = 3;

/** Maximum username length. */
const MAX_LENGTH = 20;

/** Allowed username pattern: alphanumeric and underscores only. */
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Cognito pre-sign-up trigger that validates the chosen username.
 *
 * Checks that the `preferred_username` attribute meets format requirements
 * (3–20 alphanumeric/underscore characters) and is not already taken by
 * querying the portfolio table's `username-index` GSI.
 *
 * @param event - The Cognito pre-sign-up trigger event.
 * @returns The event object (required by Cognito triggers).
 * @throws Error if the username is invalid or already taken.
 */
export async function handler(
  event: PreSignUpTriggerEvent,
): Promise<PreSignUpTriggerEvent> {
  const username = event.request.userAttributes.preferred_username;

  if (!username) {
    throw new Error('Username is required');
  }

  if (username.length < MIN_LENGTH || username.length > MAX_LENGTH) {
    throw new Error(`Username must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters`);
  }

  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Username can only contain letters, numbers, and underscores');
  }

  // Note: this check is best-effort. A TOCTOU race between concurrent signups
  // with the same username can result in duplicates. The window is small
  // (pre-signup to post-confirmation) and acceptable for current scale.
  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.PORTFOLIO_TABLE_NAME!,
    IndexName: 'username-index',
    KeyConditionExpression: '#username = :username',
    ExpressionAttributeNames: { '#username': 'username' },
    ExpressionAttributeValues: { ':username': username },
    Limit: 1,
  }));

  if (result.Items && result.Items.length > 0) {
    throw new Error('Username is already taken');
  }

  return event;
}
