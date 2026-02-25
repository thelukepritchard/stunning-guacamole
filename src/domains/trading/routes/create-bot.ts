import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { jsonResponse } from '../utils';
import type { BotRecord } from '../types';
import { TRADING_EVENT_SOURCE } from '../types';
import type { BotCreatedDetail } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});

/**
 * Creates a new trading bot.
 *
 * Expects a JSON body with `name`, `pair`, `executionMode`, and at least
 * one of `buyQuery` or `sellQuery`. A bot can have buy rules, sell rules,
 * or both. Publishes a BotCreated event to EventBridge.
 *
 * @param event - The incoming API Gateway event.
 * @returns A 201 JSON response with the created bot record.
 */
export async function createBot(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const { name, pair, executionMode, buyQuery, sellQuery, cooldownMinutes } = JSON.parse(event.body ?? '{}');

  if (!name || !pair || !executionMode) {
    return jsonResponse(400, { error: 'Missing required fields: name, pair, executionMode' });
  }

  if (executionMode !== 'once_and_wait' && executionMode !== 'condition_cooldown') {
    return jsonResponse(400, { error: 'executionMode must be once_and_wait or condition_cooldown' });
  }

  if (!buyQuery && !sellQuery) {
    return jsonResponse(400, { error: 'At least one of buyQuery or sellQuery is required' });
  }

  if (executionMode === 'once_and_wait' && (!buyQuery || !sellQuery)) {
    return jsonResponse(400, { error: 'once_and_wait mode requires both buyQuery and sellQuery' });
  }

  if (cooldownMinutes !== undefined && (typeof cooldownMinutes !== 'number' || cooldownMinutes < 0)) {
    return jsonResponse(400, { error: 'cooldownMinutes must be a non-negative number' });
  }

  const now = new Date().toISOString();
  const item: BotRecord = {
    sub,
    botId: randomUUID(),
    name,
    pair,
    status: 'draft',
    executionMode,
    createdAt: now,
    updatedAt: now,
  };

  if (buyQuery) item.buyQuery = buyQuery;
  if (sellQuery) item.sellQuery = sellQuery;
  if (cooldownMinutes !== undefined && cooldownMinutes > 0) item.cooldownMinutes = cooldownMinutes;

  await ddbDoc.send(new PutCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Item: item,
  }));

  try {
    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: TRADING_EVENT_SOURCE,
        DetailType: 'BotCreated',
        Detail: JSON.stringify({ bot: item } satisfies BotCreatedDetail),
      }],
    }));
  } catch (err) {
    console.error('Failed to publish BotCreated event:', err);
  }

  return jsonResponse(201, item);
}
