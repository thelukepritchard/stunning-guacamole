import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { jsonResponse } from '../utils';
import type { BacktestMetadataRecord } from '../../shared/types';
import { BOTS_EVENT_SOURCE } from '../../shared/types';
import type { BotDeletedDetail } from '../../shared/types';

const s3 = new S3Client({});

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

    // BatchWrite supports up to 25 items per call; retry any UnprocessedItems
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      let requestItems: Record<string, { DeleteRequest: { Key: Record<string, unknown> } }[]> | undefined = {
        [tableName]: batch.map((item) => ({
          DeleteRequest: {
            Key: { botId: item.botId, timestamp: item.timestamp },
          },
        })),
      };

      type RequestItemsMap = Record<string, { DeleteRequest: { Key: Record<string, unknown> } }[]>;
      do {
        const batchResult: { UnprocessedItems?: Record<string, unknown[]> } =
          await ddbDoc.send(new BatchWriteCommand({ RequestItems: requestItems }));
        const unprocessed = batchResult.UnprocessedItems;
        requestItems = unprocessed && Object.keys(unprocessed).length > 0
          ? (unprocessed as RequestItemsMap)
          : undefined;
      } while (requestItems);
    }
  } while (lastEvaluatedKey);
}

/**
 * Deletes a bot by ID for the authenticated user,
 * along with all associated trade and performance records.
 *
 * Publishes a BotDeleted event to EventBridge for audit purposes.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response confirming deletion.
 */
export async function deleteBot(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const botId = event.pathParameters?.botId;
  if (!botId) return jsonResponse(400, { error: 'Missing botId' });

  await ddbDoc.send(new DeleteCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub, botId },
  }));

  await Promise.all([
    deleteBotRecords(process.env.TRADES_TABLE_NAME!, botId),
    deleteBotRecords(process.env.BOT_PERFORMANCE_TABLE_NAME!, botId),
  ]);

  // Clean up backtest S3 objects and DynamoDB records
  if (process.env.BACKTESTS_TABLE_NAME) {
    try {
      let lastKey: Record<string, unknown> | undefined;
      do {
        const backtestResults = await ddbDoc.send(new QueryCommand({
          TableName: process.env.BACKTESTS_TABLE_NAME,
          IndexName: 'botId-index',
          KeyConditionExpression: 'botId = :botId',
          ExpressionAttributeValues: { ':botId': botId },
          ExclusiveStartKey: lastKey,
        }));

        const backtests = (backtestResults.Items ?? []) as BacktestMetadataRecord[];
        lastKey = backtestResults.LastEvaluatedKey as Record<string, unknown> | undefined;

        for (const bt of backtests) {
          // Delete S3 report object
          if (bt.s3Key && process.env.BACKTEST_REPORTS_BUCKET) {
            try {
              await s3.send(new DeleteObjectCommand({
                Bucket: process.env.BACKTEST_REPORTS_BUCKET,
                Key: bt.s3Key,
              }));
            } catch (s3Err) {
              console.error('Failed to delete backtest S3 object:', bt.s3Key, s3Err);
            }
          }

          // Delete DynamoDB metadata record
          await ddbDoc.send(new DeleteCommand({
            TableName: process.env.BACKTESTS_TABLE_NAME!,
            Key: { sub, backtestId: bt.backtestId },
          }));
        }
      } while (lastKey);
    } catch (err) {
      console.error('Failed to clean up backtest records:', err);
    }
  }

  try {
    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: BOTS_EVENT_SOURCE,
        DetailType: 'BotDeleted',
        Detail: JSON.stringify({
          sub,
          botId,
        } satisfies BotDeletedDetail),
      }],
    }));
  } catch (err) {
    console.error('Failed to publish BotDeleted event:', err);
  }

  return jsonResponse(200, { botId, deleted: true });
}
