import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import { ensureBalance } from './get-balance';
import { DEMO_COINS } from '../../../shared/types';
import type { DemoOrderRecord } from '../../../shared/types';
import { fetchBtcPrice } from '../../../shared/fetch-utils';
import { randomUUID } from 'node:crypto';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const BALANCES_TABLE = process.env.BALANCES_TABLE_NAME!;
const ORDERS_TABLE = process.env.ORDERS_TABLE_NAME!;

/**
 * Places a market order on the demo exchange. The order is always filled
 * immediately at the current Binance BTC price. The balance update and
 * order record are written in a single DynamoDB transaction to ensure
 * atomicity.
 *
 * @param event - API Gateway event with JSON body: `{ sub, pair, side, size }`.
 * @returns JSON response containing the filled order record.
 */
export async function placeOrder(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const { sub, pair, side, size } = body;

  if (!sub || !pair || !side || size == null) {
    return jsonResponse(400, { error: 'Missing required fields: sub, pair, side, size' });
  }

  if (side !== 'buy' && side !== 'sell') {
    return jsonResponse(400, { error: 'side must be "buy" or "sell"' });
  }

  if (typeof size !== 'number' || size <= 0) {
    return jsonResponse(400, { error: 'size must be a positive number' });
  }

  const validCoin = DEMO_COINS.find(c => c.ticker === pair);
  if (!validCoin) {
    return jsonResponse(400, { error: `Unsupported pair: ${pair}. Available: ${DEMO_COINS.map(c => c.ticker).join(', ')}` });
  }

  // Ensure user has a balance record (seeds default if new)
  await ensureBalance(sub as string);

  // Fetch live BTC price from Binance
  let price: number;
  try {
    price = await fetchBtcPrice();
  } catch {
    return jsonResponse(502, { error: 'Failed to fetch current price from Binance' });
  }

  const now = new Date().toISOString();
  const total = parseFloat((size * price).toFixed(2));

  // Build the order record
  const order: DemoOrderRecord = {
    sub: sub as string,
    orderId: randomUUID(),
    pair: pair as string,
    side: side as 'buy' | 'sell',
    type: 'market',
    size,
    executedPrice: price,
    total,
    status: 'filled',
    createdAt: now,
  };

  // Atomically update balance + write order record in a single transaction
  try {
    const balanceUpdate = side === 'buy'
      ? {
          UpdateExpression: 'SET usd = usd - :cost, btc = btc + :size, updatedAt = :now',
          ConditionExpression: 'usd >= :cost',
          ExpressionAttributeValues: { ':cost': total, ':size': size, ':now': now },
        }
      : {
          UpdateExpression: 'SET btc = btc - :size, usd = usd + :proceeds, updatedAt = :now',
          ConditionExpression: 'btc >= :size',
          ExpressionAttributeValues: { ':size': size, ':proceeds': total, ':now': now },
        };

    await ddbDoc.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: BALANCES_TABLE,
            Key: { sub: sub as string },
            ...balanceUpdate,
          },
        },
        {
          Put: {
            TableName: ORDERS_TABLE,
            Item: order,
          },
        },
      ],
    }));
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'TransactionCanceledException') {
      const currency = side === 'buy' ? 'USD' : 'BTC';
      const failReason = `Insufficient ${currency} balance`;

      // Write a failed order record so the user can see why the order was rejected
      const failedOrder: DemoOrderRecord = {
        ...order,
        status: 'failed',
        failReason,
      };

      await ddbDoc.send(new PutCommand({
        TableName: ORDERS_TABLE,
        Item: failedOrder,
      }));

      return jsonResponse(200, failedOrder);
    }
    throw err;
  }

  return jsonResponse(201, order);
}
