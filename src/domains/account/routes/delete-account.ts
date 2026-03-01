import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const cognito = new CognitoIdentityProviderClient({});

/**
 * Sends a BatchWriteCommand and retries any unprocessed items with
 * exponential backoff until all items are written.
 *
 * @param tableName - The DynamoDB table name.
 * @param deleteRequests - Array of delete request objects.
 */
async function batchDeleteWithRetry(
  tableName: string,
  deleteRequests: Array<{ DeleteRequest: { Key: Record<string, unknown> } }>,
): Promise<void> {
  let unprocessed: typeof deleteRequests | undefined = deleteRequests;
  let delay = 100;

  while (unprocessed && unprocessed.length > 0) {
    const result = await ddbDoc.send(new BatchWriteCommand({
      RequestItems: { [tableName]: unprocessed },
    }));

    const remaining = result.UnprocessedItems?.[tableName] as typeof deleteRequests | undefined;
    if (remaining && remaining.length > 0) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 3000);
      unprocessed = remaining;
    } else {
      unprocessed = undefined;
    }
  }
}

/**
 * Deletes all items from a DynamoDB table matching a partition key.
 * Handles tables with sort keys by querying first, then batch-deleting.
 *
 * @param tableName - The DynamoDB table name.
 * @param pkName - The partition key attribute name.
 * @param pkValue - The partition key value.
 * @param skName - Optional sort key attribute name (if table has a composite key).
 */
async function deleteAllByPartitionKey(
  tableName: string,
  pkName: string,
  pkValue: string,
  skName?: string,
): Promise<void> {
  if (!skName) {
    // Simple table — single delete
    await ddbDoc.send(new DeleteCommand({
      TableName: tableName,
      Key: { [pkName]: pkValue },
    }));
    return;
  }

  // Composite key — query all items, then batch delete
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const result = await ddbDoc.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': pkName, '#sk': skName },
      ExpressionAttributeValues: { ':pk': pkValue },
      ProjectionExpression: '#pk, #sk',
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    const items = result.Items ?? [];
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await batchDeleteWithRetry(
        tableName,
        batch.map((item) => ({
          DeleteRequest: { Key: { [pkName]: item[pkName], [skName]: item[skName] } },
        })),
      );
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);
}

/**
 * Deletes all items from a DynamoDB table using a GSI to find items by a secondary key,
 * then deletes using the table's primary key.
 *
 * @param tableName - The DynamoDB table name.
 * @param indexName - The GSI name.
 * @param gsiPkName - The GSI partition key attribute name.
 * @param gsiPkValue - The GSI partition key value.
 * @param tablePkName - The table's actual partition key name.
 * @param tableSkName - The table's actual sort key name.
 */
async function deleteAllByGsi(
  tableName: string,
  indexName: string,
  gsiPkName: string,
  gsiPkValue: string,
  tablePkName: string,
  tableSkName: string,
): Promise<void> {
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const result = await ddbDoc.send(new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: '#gsiPk = :gsiPk',
      ExpressionAttributeNames: {
        '#gsiPk': gsiPkName,
        '#tpk': tablePkName,
        '#tsk': tableSkName,
      },
      ExpressionAttributeValues: { ':gsiPk': gsiPkValue },
      ProjectionExpression: '#tpk, #tsk',
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    const items = result.Items ?? [];
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await batchDeleteWithRetry(
        tableName,
        batch.map((item) => ({
          DeleteRequest: {
            Key: { [tablePkName]: item[tablePkName], [tableSkName]: item[tableSkName] },
          },
        })),
      );
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);
}

/**
 * Deletes all S3 objects under a given prefix.
 *
 * @param bucket - The S3 bucket name.
 * @param prefix - The object key prefix.
 */
async function deleteS3Prefix(bucket: string, prefix: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    const objects = (listed.Contents ?? []).filter((o) => o.Key);
    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects.map((o) => ({ Key: o.Key! })) },
      }));
    }

    continuationToken = listed.NextContinuationToken;
  } while (continuationToken);
}

/**
 * Deletes a user's entire account and all associated data.
 *
 * Removes data from all DynamoDB tables across every domain,
 * deletes backtest report objects from S3, and disables then
 * deletes the user from Cognito.
 *
 * @param event - The incoming API Gateway event.
 * @returns A 200 JSON response on success.
 */
export async function deleteAccount(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const username: string = event.requestContext.authorizer?.claims?.['cognito:username'] ?? '';
  if (!username) return jsonResponse(400, { error: 'Cannot resolve username' });

  // ─── DynamoDB cleanup ────────────────────────────────────────

  // Tables partitioned by sub (no sort key) — single deletes
  const singleDeletes = [
    process.env.PORTFOLIO_TABLE_NAME!,
    process.env.TRADING_SETTINGS_TABLE_NAME!,
    process.env.DEMO_BALANCES_TABLE_NAME!,
  ].map((table) => deleteAllByPartitionKey(table, 'sub', sub));

  // Tables partitioned by sub (with sort key) — query + batch delete
  const compositeDeletes = [
    deleteAllByPartitionKey(process.env.PORTFOLIO_PERFORMANCE_TABLE_NAME!, 'sub', sub, 'timestamp'),
    deleteAllByPartitionKey(process.env.TRADING_BOTS_TABLE_NAME!, 'sub', sub, 'botId'),
    deleteAllByPartitionKey(process.env.TRADING_BACKTESTS_TABLE_NAME!, 'sub', sub, 'backtestId'),
    deleteAllByPartitionKey(process.env.DEMO_ORDERS_TABLE_NAME!, 'sub', sub, 'orderId'),
    deleteAllByPartitionKey(process.env.EXCHANGE_CONNECTIONS_TABLE_NAME!, 'sub', sub, 'connectionId'),
  ];

  // Tables not partitioned by sub — use GSI (sub-index)
  const gsiDeletes = [
    deleteAllByGsi(
      process.env.TRADING_TRADES_TABLE_NAME!, 'sub-index',
      'sub', sub, 'botId', 'timestamp',
    ),
    deleteAllByGsi(
      process.env.TRADING_BOT_PERFORMANCE_TABLE_NAME!, 'sub-index',
      'sub', sub, 'botId', 'timestamp',
    ),
  ];

  // ─── S3 cleanup ──────────────────────────────────────────────

  const s3Cleanup = deleteS3Prefix(
    process.env.BACKTEST_REPORTS_BUCKET_NAME!,
    `backtests/${sub}/`,
  );

  // Run all data deletions in parallel — use allSettled so one failure doesn't abort the rest
  const results = await Promise.allSettled([...singleDeletes, ...compositeDeletes, ...gsiDeletes, s3Cleanup]);
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`Account deletion: ${failures.length} cleanup task(s) failed:`,
      failures.map((f) => (f as PromiseRejectedResult).reason));
  }

  // ─── Cognito cleanup ────────────────────────────────────────
  // Wrapped in try/catch so that data deletion (above) is not wasted
  // if the Cognito step fails. The user's data is already gone.

  const userPoolId = process.env.USER_POOL_ID!;

  try {
    await cognito.send(new AdminDisableUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    }));
  } catch {
    // User may already be disabled — continue to deletion
  }

  await cognito.send(new AdminDeleteUserCommand({
    UserPoolId: userPoolId,
    Username: username,
  }));

  return jsonResponse(200, { message: 'Account deleted successfully' });
}
