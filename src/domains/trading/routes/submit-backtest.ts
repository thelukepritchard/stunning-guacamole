import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { randomUUID } from 'node:crypto';
import { jsonResponse } from '../utils';
import type { BotRecord, BacktestMetadataRecord } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sfn = new SFNClient({});

/** Minimum artificial wait time in seconds for backtest processing. */
const MIN_WAIT_SECONDS = 300;

/** Maximum artificial wait time in seconds for backtest processing. */
const MAX_WAIT_SECONDS = 600;

/**
 * Submits a bot for backtesting. Validates bot ownership, checks that no
 * backtest is already in-flight, verifies sufficient price history data,
 * snapshots the bot config, writes a pending metadata record to DynamoDB,
 * and starts the Step Functions backtest workflow.
 *
 * Returns 202 Accepted with the backtestId and pending status.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with backtestId and status.
 */
export async function submitBacktest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const botId = event.pathParameters?.botId;
  if (!botId) return jsonResponse(400, { error: 'Missing botId' });

  // Verify bot ownership
  const botResult = await ddbDoc.send(new GetCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub, botId },
  }));

  const bot = botResult.Item as BotRecord | undefined;
  if (!bot) return jsonResponse(404, { error: 'Bot not found' });

  // Check no pending or running backtest exists for this bot
  const inflightResult = await ddbDoc.send(new QueryCommand({
    TableName: process.env.BACKTESTS_TABLE_NAME!,
    IndexName: 'botId-index',
    KeyConditionExpression: 'botId = :botId',
    FilterExpression: '#status IN (:pending, :running)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':botId': botId,
      ':pending': 'pending',
      ':running': 'running',
    },
  }));

  if (inflightResult.Items && inflightResult.Items.length > 0) {
    return jsonResponse(409, { error: 'A backtest is already in progress for this bot' });
  }

  // Validate price history has >= 7 days of data for the bot's pair.
  // We check that at least one record exists in the early portion of the 30-day window
  // (between windowStart and 7 days ago), confirming the data spans far enough back.
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const priceCheck = await ddbDoc.send(new QueryCommand({
    TableName: process.env.PRICE_HISTORY_TABLE_NAME!,
    KeyConditionExpression: '#pair = :pair AND #ts BETWEEN :windowStart AND :sevenDaysAgo',
    ExpressionAttributeNames: { '#pair': 'pair', '#ts': 'timestamp' },
    ExpressionAttributeValues: {
      ':pair': bot.pair,
      ':windowStart': windowStart,
      ':sevenDaysAgo': sevenDaysAgo,
    },
    ScanIndexForward: false,
    Limit: 1,
  }));

  if (!priceCheck.Items || priceCheck.Items.length === 0) {
    return jsonResponse(400, {
      error: 'Insufficient price history data. At least 7 days of data is required for backtesting.',
    });
  }

  // Create backtest metadata record
  const backtestId = randomUUID();
  const testedAt = now.toISOString();

  // Randomise wait between MIN_WAIT_SECONDS and MAX_WAIT_SECONDS to feel organic.
  // The artificial delay acts as a natural rate limiter and communicates to the user
  // that meaningful analysis is being performed.
  const waitSeconds = Math.floor(Math.random() * (MAX_WAIT_SECONDS - MIN_WAIT_SECONDS + 1)) + MIN_WAIT_SECONDS;

  const metadata: BacktestMetadataRecord = {
    sub,
    backtestId,
    botId,
    status: 'pending',
    botConfigSnapshot: bot,
    configChangedSinceTest: false,
    testedAt,
    windowStart,
    windowEnd,
  };

  await ddbDoc.send(new PutCommand({
    TableName: process.env.BACKTESTS_TABLE_NAME!,
    Item: metadata,
  }));

  // Start the Step Functions workflow
  await sfn.send(new StartExecutionCommand({
    stateMachineArn: process.env.BACKTEST_WORKFLOW_ARN!,
    name: backtestId,
    input: JSON.stringify({
      backtestId,
      sub,
      botId,
      botConfigSnapshot: bot,
      windowStart,
      windowEnd,
      waitSeconds,
    }),
  }));

  return jsonResponse(202, { backtestId, status: 'pending' });
}
