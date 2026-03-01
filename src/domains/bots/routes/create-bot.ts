import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { jsonResponse } from '../utils';
import type { BotRecord, ExchangeId } from '../../shared/types';
import { BOTS_EVENT_SOURCE, EXCHANGES } from '../../shared/types';
import type { BotCreatedDetail } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});

/**
 * Validates a SizingConfig object.
 *
 * @param sizing - The sizing configuration to validate.
 * @param label - A label for error messages (e.g. 'buySizing').
 * @returns An error message string, or undefined if valid.
 */
function validateSizing(sizing: unknown, label: string): string | undefined {
  if (sizing === undefined || sizing === null) return undefined;
  if (typeof sizing !== 'object') return `${label} must be an object`;
  const s = sizing as Record<string, unknown>;
  if (s.type !== 'fixed' && s.type !== 'percentage') {
    return `${label}.type must be 'fixed' or 'percentage'`;
  }
  if (typeof s.value !== 'number' || s.value <= 0) {
    return `${label}.value must be a positive number`;
  }
  if (s.type === 'percentage' && s.value > 100) {
    return `${label}.value must be between 0 and 100 for percentage type`;
  }
  return undefined;
}

/**
 * Validates a StopLossConfig object.
 *
 * @param sl - The stop-loss configuration to validate.
 * @returns An error message string, or undefined if valid.
 */
function validateStopLoss(sl: unknown): string | undefined {
  if (sl === undefined || sl === null) return undefined;
  if (typeof sl !== 'object') return 'stopLoss must be an object';
  const s = sl as Record<string, unknown>;
  if (typeof s.percentage !== 'number' || s.percentage <= 0 || s.percentage > 100) {
    return 'stopLoss.percentage must be a number between 0 and 100';
  }
  return undefined;
}

/**
 * Validates a TakeProfitConfig object.
 *
 * @param tp - The take-profit configuration to validate.
 * @returns An error message string, or undefined if valid.
 */
function validateTakeProfit(tp: unknown): string | undefined {
  if (tp === undefined || tp === null) return undefined;
  if (typeof tp !== 'object') return 'takeProfit must be an object';
  const t = tp as Record<string, unknown>;
  if (typeof t.percentage !== 'number' || t.percentage <= 0 || t.percentage > 100) {
    return 'takeProfit.percentage must be a number between 0 and 100';
  }
  return undefined;
}

/**
 * Creates a new trading bot.
 *
 * Expects a JSON body with `name`, `pair`, `executionMode`, and at least
 * one of `buyQuery` or `sellQuery`. Position sizing (`buySizing` /
 * `sellSizing`) is mandatory for each enabled action. Optionally accepts
 * `stopLoss` and `takeProfit`. Publishes a BotCreated event to EventBridge.
 *
 * @param event - The incoming API Gateway event.
 * @returns A 201 JSON response with the created bot record.
 */
export async function createBot(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const {
    name, pair, executionMode, buyQuery, sellQuery, cooldownMinutes,
    buySizing, sellSizing, stopLoss, takeProfit, exchangeId: rawExchangeId,
  } = JSON.parse(event.body ?? '{}');

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

  // Validate exchangeId — defaults to 'demo' if not provided
  const exchangeId: ExchangeId = rawExchangeId ?? 'demo';
  if (!(exchangeId in EXCHANGES)) {
    return jsonResponse(400, { error: `Invalid exchangeId: ${exchangeId}` });
  }

  // Sizing is mandatory when the corresponding action has a query
  if (buyQuery && !buySizing) {
    return jsonResponse(400, { error: 'buySizing is required when buyQuery is provided' });
  }
  if (sellQuery && !sellSizing) {
    return jsonResponse(400, { error: 'sellSizing is required when sellQuery is provided' });
  }

  // Validate sizing configs
  const buySizingError = validateSizing(buySizing, 'buySizing');
  if (buySizingError) return jsonResponse(400, { error: buySizingError });

  const sellSizingError = validateSizing(sellSizing, 'sellSizing');
  if (sellSizingError) return jsonResponse(400, { error: sellSizingError });

  // Validate stop-loss and take-profit
  const slError = validateStopLoss(stopLoss);
  if (slError) return jsonResponse(400, { error: slError });

  const tpError = validateTakeProfit(takeProfit);
  if (tpError) return jsonResponse(400, { error: tpError });

  const now = new Date().toISOString();
  const item: BotRecord = {
    sub,
    botId: randomUUID(),
    name,
    pair,
    status: 'draft',
    executionMode,
    exchangeId,
    createdAt: now,
    updatedAt: now,
  };

  if (buyQuery) { item.buyQuery = buyQuery; item.buySizing = buySizing; }
  if (sellQuery) { item.sellQuery = sellQuery; item.sellSizing = sellSizing; }
  if (cooldownMinutes !== undefined && cooldownMinutes > 0) item.cooldownMinutes = cooldownMinutes;
  if (stopLoss) item.stopLoss = stopLoss;
  if (takeProfit) item.takeProfit = takeProfit;

  await ddbDoc.send(new PutCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Item: item,
  }));

  try {
    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: BOTS_EVENT_SOURCE,
        DetailType: 'BotCreated',
        Detail: JSON.stringify({ bot: item } satisfies BotCreatedDetail),
      }],
    }));
  } catch (err) {
    console.error('Failed to publish BotCreated event:', err);
  }

  return jsonResponse(201, item);
}
