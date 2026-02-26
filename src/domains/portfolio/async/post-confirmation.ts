import { randomUUID } from 'node:crypto';
import type { PostConfirmationConfirmSignUpTriggerEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { PortfolioRecord } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Creates a default "RSI Dip Buyer" bot in draft mode for a new user.
 *
 * The bot uses RSI(7) < 40 as the buy signal and RSI(7) > 60 as the
 * sell signal on the BTCUSDT pair, giving new users a ready-to-review
 * starter strategy.
 *
 * @param sub - The Cognito user ID.
 */
async function createDefaultBot(sub: string): Promise<void> {
  const now = new Date().toISOString();

  await ddbDoc.send(new PutCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Item: {
      sub,
      botId: randomUUID(),
      name: 'RSI Dip Buyer',
      pair: 'BTCUSDT',
      status: 'draft',
      executionMode: 'once_and_wait',
      buyQuery: {
        combinator: 'and',
        rules: [{ field: 'rsi_7', operator: '<', value: '40' }],
      },
      sellQuery: {
        combinator: 'and',
        rules: [{ field: 'rsi_7', operator: '>', value: '60' }],
      },
      buySizing: { type: 'percentage', value: 10 },
      sellSizing: { type: 'percentage', value: 100 },
      createdAt: now,
      updatedAt: now,
    },
  }));

  console.log(`Created default bot for user ${sub}`);
}

/**
 * Cognito post-confirmation trigger that creates a portfolio entry
 * and a default starter bot for newly confirmed users.
 *
 * Writes a record to the portfolio DynamoDB table with the user's
 * Cognito `sub` as the partition key. Uses a conditional write to
 * ensure idempotency (duplicate triggers won't overwrite). Also
 * creates an "RSI Dip Buyer" bot in draft mode in the trading bots
 * table so new users have a starter strategy to explore.
 *
 * @param event - The Cognito post-confirmation trigger event.
 * @returns The event object (required by Cognito triggers).
 */
export async function handler(
  event: PostConfirmationConfirmSignUpTriggerEvent,
): Promise<PostConfirmationConfirmSignUpTriggerEvent> {
  const sub = event.request.userAttributes.sub;
  const username = event.request.userAttributes.preferred_username;
  if (!username) {
    throw new Error('preferred_username is required on post-confirmation');
  }

  const record: PortfolioRecord = {
    sub,
    username,
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
      return event;
    }
    throw err;
  }

  // Create a default starter bot for the new user (best-effort — signup
  // succeeds even if this fails so we don't block account creation).
  try {
    await createDefaultBot(sub);
  } catch (err) {
    console.error('Failed to create default bot — signup continues:', err);
  }

  return event;
}
