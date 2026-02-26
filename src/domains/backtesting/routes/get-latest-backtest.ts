import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { jsonResponse } from '../utils';
import type { BotRecord, BacktestMetadataRecord, BacktestReport } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

/**
 * Returns the most recent backtest metadata for a bot. Used by the frontend
 * for polling during backtest execution (every 15 seconds).
 *
 * When status is 'completed', includes the summary from the S3 report
 * but omits hourlyBuckets to keep the response lightweight.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with the latest backtest metadata and optional summary.
 */
export async function getLatestBacktest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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

  // Get the most recent backtest
  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.BACKTESTS_TABLE_NAME!,
    IndexName: 'botId-index',
    KeyConditionExpression: 'botId = :botId',
    ExpressionAttributeValues: { ':botId': botId },
    ScanIndexForward: false,
    Limit: 1,
  }));

  const backtests = (result.Items ?? []) as BacktestMetadataRecord[];
  if (backtests.length === 0) {
    return jsonResponse(404, { error: 'No backtests found for this bot' });
  }

  const latest = backtests[0]!;

  // If completed, fetch summary from S3 (without hourlyBuckets)
  if (latest.status === 'completed' && latest.s3Key) {
    try {
      const s3Result = await s3.send(new GetObjectCommand({
        Bucket: process.env.BACKTEST_REPORTS_BUCKET!,
        Key: latest.s3Key,
      }));

      if (!s3Result.Body) return jsonResponse(200, latest);
      const reportJson = await s3Result.Body.transformToString();
      const report = JSON.parse(reportJson) as BacktestReport;

      return jsonResponse(200, { ...latest, summary: report.summary });
    } catch (err) {
      console.error('Failed to fetch S3 report for latest backtest:', err);
      // Fall back to metadata without summary
      return jsonResponse(200, latest);
    }
  }

  return jsonResponse(200, latest);
}
