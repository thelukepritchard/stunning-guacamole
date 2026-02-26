import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { jsonResponse } from '../utils';
import type { BotRecord, BacktestMetadataRecord, BacktestReport } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

/**
 * Fetches the full backtest report from S3 and returns it to the client.
 * Acts as an API proxy — S3 is never exposed directly.
 *
 * Validates bot ownership and that the backtest belongs to the requested bot.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with the complete backtest report.
 */
export async function getBacktest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const botId = event.pathParameters?.botId;
  const backtestId = event.pathParameters?.backtestId;
  if (!botId) return jsonResponse(400, { error: 'Missing botId' });
  if (!backtestId) return jsonResponse(400, { error: 'Missing backtestId' });

  // Verify bot ownership
  const botResult = await ddbDoc.send(new GetCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub, botId },
  }));

  const bot = botResult.Item as BotRecord | undefined;
  if (!bot) return jsonResponse(404, { error: 'Bot not found' });

  // Fetch backtest metadata
  const backtestResult = await ddbDoc.send(new GetCommand({
    TableName: process.env.BACKTESTS_TABLE_NAME!,
    Key: { sub, backtestId },
  }));

  const metadata = backtestResult.Item as BacktestMetadataRecord | undefined;
  if (!metadata) return jsonResponse(404, { error: 'Backtest not found' });

  // Verify the backtest belongs to the requested bot
  if (metadata.botId !== botId) {
    return jsonResponse(404, { error: 'Backtest not found for this bot' });
  }

  if (metadata.status !== 'completed' || !metadata.s3Key) {
    return jsonResponse(200, {
      ...metadata,
      message: metadata.status === 'failed'
        ? 'Backtest failed'
        : 'Backtest is still in progress',
    });
  }

  // Fetch full report from S3
  try {
    const s3Result = await s3.send(new GetObjectCommand({
      Bucket: process.env.BACKTEST_REPORTS_BUCKET!,
      Key: metadata.s3Key,
    }));

    if (!s3Result.Body) {
      return jsonResponse(500, { error: 'Report content unavailable' });
    }

    const reportJson = await s3Result.Body.transformToString();
    const report = JSON.parse(reportJson) as BacktestReport;

    return jsonResponse(200, { ...metadata, report });
  } catch (err) {
    console.error('Failed to fetch backtest report from S3:', err);
    return jsonResponse(500, { error: 'Failed to retrieve backtest report' });
  }
}
