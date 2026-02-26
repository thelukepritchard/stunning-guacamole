import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { BacktestReport, BacktestMetadataRecord, BacktestCompletedDetail } from '../types';
import { TRADING_EVENT_SOURCE } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const eventBridge = new EventBridgeClient({});

/** Maximum number of backtest results to retain per bot. */
const MAX_RESULTS_PER_BOT = 5;

/** Step Functions input for the write-report step. */
interface WriteReportInput {
  backtestId: string;
  sub: string;
  botId: string;
  windowStart: string;
  windowEnd: string;
  report: BacktestReport;
}

/** Step Functions input when invoked as a failure handler. */
interface FailureInput {
  failed: true;
  error: string;
  cause: string;
  backtestId: string;
  sub: string;
}

/**
 * Step Functions Step 4 — WriteReport.
 *
 * Serialises the backtest report to JSON, writes it to S3, updates the
 * DynamoDB metadata record to 'completed', and enforces the rolling
 * 5-result cap per bot.
 *
 * Also handles failure cases when invoked by the Step Functions catch
 * handler — updates the DynamoDB record status to 'failed' with an
 * error message.
 *
 * @param event - The Step Functions input from the engine step, or a failure payload.
 * @returns Confirmation of the write operation.
 */
export async function handler(event: WriteReportInput | FailureInput) {
  // Handle failure case
  if ('failed' in event && event.failed) {
    const { backtestId, sub, error, cause } = event;
    const rawMessage = cause || error || 'Unknown error';
    // Truncate to avoid leaking full stack traces into DynamoDB
    const errorMessage = rawMessage.length > 500 ? rawMessage.slice(0, 500) : rawMessage;

    await ddbDoc.send(new UpdateCommand({
      TableName: process.env.BACKTESTS_TABLE_NAME!,
      Key: { sub, backtestId },
      UpdateExpression: 'SET #status = :failed, errorMessage = :errorMessage',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':failed': 'failed',
        ':errorMessage': errorMessage,
      },
    }));

    return { status: 'failed', backtestId, errorMessage };
  }

  const { backtestId, sub, botId, report } = event as WriteReportInput;

  // Write report to S3
  const s3Key = `backtests/${sub}/${botId}/${backtestId}.json`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.BACKTEST_REPORTS_BUCKET!,
    Key: s3Key,
    Body: JSON.stringify(report),
    ContentType: 'application/json',
  }));

  // Update DynamoDB metadata to completed
  const completedAt = new Date().toISOString();
  await ddbDoc.send(new UpdateCommand({
    TableName: process.env.BACKTESTS_TABLE_NAME!,
    Key: { sub, backtestId },
    UpdateExpression: 'SET #status = :completed, s3Key = :s3Key, completedAt = :completedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':completed': 'completed',
      ':s3Key': s3Key,
      ':completedAt': completedAt,
    },
  }));

  // Enforce rolling 5-result cap — only count completed records to avoid
  // evicting good reports in favour of failed ones
  const existingResults = await ddbDoc.send(new QueryCommand({
    TableName: process.env.BACKTESTS_TABLE_NAME!,
    IndexName: 'botId-index',
    KeyConditionExpression: 'botId = :botId',
    FilterExpression: '#status = :completed',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':botId': botId, ':completed': 'completed' },
    ScanIndexForward: true,
  }));

  const allResults = (existingResults.Items ?? []) as BacktestMetadataRecord[];

  if (allResults.length > MAX_RESULTS_PER_BOT) {
    // Delete the oldest completed results beyond the cap
    const toDelete = allResults.slice(0, allResults.length - MAX_RESULTS_PER_BOT);

    for (const record of toDelete) {
      // Delete S3 object if exists
      if (record.s3Key) {
        try {
          await s3.send(new DeleteObjectCommand({
            Bucket: process.env.BACKTEST_REPORTS_BUCKET!,
            Key: record.s3Key,
          }));
        } catch (err) {
          console.error('Failed to delete S3 object:', record.s3Key, err);
        }
      }

      // Delete DynamoDB record
      await ddbDoc.send(new DeleteCommand({
        TableName: process.env.BACKTESTS_TABLE_NAME!,
        Key: { sub: record.sub, backtestId: record.backtestId },
      }));
    }
  }

  // Publish BacktestCompleted event
  try {
    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: TRADING_EVENT_SOURCE,
        DetailType: 'BacktestCompleted',
        Detail: JSON.stringify({
          sub,
          botId,
          backtestId,
          status: 'completed',
        } satisfies BacktestCompletedDetail),
      }],
    }));
  } catch (err) {
    console.error('Failed to publish BacktestCompleted event:', err);
  }

  return { status: 'completed', backtestId, s3Key };
}
