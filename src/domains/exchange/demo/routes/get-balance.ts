import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import { DEFAULT_DEMO_BALANCE } from '../../../shared/types';
import type { DemoBalanceRecord } from '../../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const BALANCES_TABLE = process.env.BALANCES_TABLE_NAME!;

/**
 * Returns the demo balance for a user. Seeds a new balance record with
 * the default starting amount if the user has no existing balance.
 *
 * @param event - API Gateway event with `sub` query parameter.
 * @returns JSON response containing the user's demo balances.
 */
export async function getBalance(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.queryStringParameters?.sub;
  if (!sub) {
    return jsonResponse(400, { error: 'Missing required query parameter: sub' });
  }

  const balance = await ensureBalance(sub);
  return jsonResponse(200, balance);
}

/**
 * Retrieves the user's balance record, creating one with the default
 * starting balance if it does not yet exist.
 *
 * @param sub - The user identifier.
 * @returns The user's demo balance record.
 */
export async function ensureBalance(sub: string): Promise<DemoBalanceRecord> {
  const { Item } = await ddbDoc.send(new GetCommand({
    TableName: BALANCES_TABLE,
    Key: { sub },
  }));

  if (Item) return Item as DemoBalanceRecord;

  const now = new Date().toISOString();
  const newBalance: DemoBalanceRecord = {
    sub,
    aud: DEFAULT_DEMO_BALANCE,
    btc: 0,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ddbDoc.send(new PutCommand({
      TableName: BALANCES_TABLE,
      Item: newBalance,
      ConditionExpression: 'attribute_not_exists(#sub)',
      ExpressionAttributeNames: { '#sub': 'sub' },
    }));
    return newBalance;
  } catch (err) {
    // Only swallow ConditionalCheckFailedException (concurrent seed race)
    if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') {
      throw err;
    }
  }

  const { Item: seeded } = await ddbDoc.send(new GetCommand({
    TableName: BALANCES_TABLE,
    Key: { sub },
  }));

  if (!seeded) {
    throw new Error('Failed to seed balance record');
  }

  return seeded as DemoBalanceRecord;
}
