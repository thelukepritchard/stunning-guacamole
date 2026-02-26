import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { BotRecord } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Step Functions input for the validate step. */
interface ValidateInput {
  backtestId: string;
  sub: string;
  botId: string;
  botConfigSnapshot: BotRecord;
  windowStart: string;
  windowEnd: string;
  waitSeconds: number;
}

/**
 * Step Functions Step 1 — ValidateAndSnapshot.
 *
 * Validates that the bot exists and belongs to the user, confirms no other
 * backtest is already pending or running for this bot, and updates the
 * metadata record status from 'pending' to 'running'.
 *
 * Returns the validated input plus waitSeconds for the subsequent Wait state.
 *
 * @param event - The Step Functions input payload.
 * @returns The validated backtest context for downstream steps.
 */
export async function handler(event: ValidateInput) {
  const { backtestId, sub, botId, botConfigSnapshot, windowStart, windowEnd, waitSeconds } = event;

  // Verify bot still exists and belongs to user
  const botResult = await ddbDoc.send(new GetCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub, botId },
  }));

  if (!botResult.Item) {
    throw new Error('Bot not found or does not belong to user');
  }

  // Confirm no other pending/running backtest (besides this one)
  const inflightResult = await ddbDoc.send(new QueryCommand({
    TableName: process.env.BACKTESTS_TABLE_NAME!,
    IndexName: 'botId-index',
    KeyConditionExpression: 'botId = :botId',
    FilterExpression: '#status IN (:pending, :running) AND backtestId <> :backtestId',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':botId': botId,
      ':pending': 'pending',
      ':running': 'running',
      ':backtestId': backtestId,
    },
  }));

  if (inflightResult.Items && inflightResult.Items.length > 0) {
    throw new Error('Another backtest is already in progress for this bot');
  }

  // Update status to running
  await ddbDoc.send(new UpdateCommand({
    TableName: process.env.BACKTESTS_TABLE_NAME!,
    Key: { sub, backtestId },
    UpdateExpression: 'SET #status = :running',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':running': 'running' },
  }));

  return {
    backtestId,
    sub,
    botId,
    botConfigSnapshot,
    windowStart,
    windowEnd,
    waitSeconds,
  };
}
