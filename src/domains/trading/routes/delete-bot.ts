import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { jsonResponse } from '../utils';
import type { BotRecord } from '../types';
import { TRADING_EVENT_SOURCE } from '../types';
import type { BotDeletedDetail } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});

/**
 * Deletes all items from a table matching the given botId in batches of 25.
 * Works for any table with partition key `botId` and sort key `timestamp`.
 *
 * @param tableName - The DynamoDB table name.
 * @param botId - The bot ID whose records should be deleted.
 */
async function deleteBotRecords(tableName: string, botId: string): Promise<void> {
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await ddbDoc.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'botId = :botId',
      ExpressionAttributeValues: { ':botId': botId },
      ProjectionExpression: 'botId, #ts',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    const items = result.Items ?? [];
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;

    // BatchWrite supports up to 25 items per call
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await ddbDoc.send(new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((item) => ({
            DeleteRequest: {
              Key: { botId: item.botId, timestamp: item.timestamp },
            },
          })),
        },
      }));
    }
  } while (lastEvaluatedKey);
}

/**
 * Deletes a bot by ID for the authenticated user,
 * along with all associated trade and performance records.
 *
 * Fetches the bot before deletion to capture the subscriptionArn
 * for the BotDeleted event, enabling the lifecycle handler to
 * clean up the SNS subscription.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response confirming deletion.
 */
export async function deleteBot(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const botId = event.pathParameters?.botId;
  if (!botId) return jsonResponse(400, { error: 'Missing botId' });

  // Fetch bot before deletion to capture subscriptionArn for event
  const existing = await ddbDoc.send(new GetCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub, botId },
  }));
  const bot = existing.Item as BotRecord | undefined;

  await ddbDoc.send(new DeleteCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub, botId },
  }));

  await Promise.all([
    deleteBotRecords(process.env.TRADES_TABLE_NAME!, botId),
    deleteBotRecords(process.env.BOT_PERFORMANCE_TABLE_NAME!, botId),
  ]);

  // Publish BotDeleted event only if the bot existed
  if (bot) {
    try {
      await eventBridge.send(new PutEventsCommand({
        Entries: [{
          Source: TRADING_EVENT_SOURCE,
          DetailType: 'BotDeleted',
          Detail: JSON.stringify({
            sub,
            botId,
            subscriptionArn: bot.subscriptionArn,
          } satisfies BotDeletedDetail),
        }],
      }));
    } catch (err) {
      console.error('Failed to publish BotDeleted event:', err);
    }
  }

  return jsonResponse(200, { botId, deleted: true });
}
