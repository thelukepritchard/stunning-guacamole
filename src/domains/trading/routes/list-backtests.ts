import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import type { BotRecord, BacktestMetadataRecord } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Lists all backtest metadata records for a bot (up to 5), sorted newest first.
 * Validates bot ownership before returning results.
 * Does not include full report payload — use getBacktest for full reports.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with an array of backtest metadata records.
 */
export async function listBacktests(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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

  // Query backtests by botId, sorted newest first
  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.BACKTESTS_TABLE_NAME!,
    IndexName: 'botId-index',
    KeyConditionExpression: 'botId = :botId',
    ExpressionAttributeValues: { ':botId': botId },
    ScanIndexForward: false,
    Limit: 5,
  }));

  const backtests = (result.Items ?? []) as BacktestMetadataRecord[];

  return jsonResponse(200, backtests);
}
