import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { jsonResponse } from '../utils';
import type { BotRecord, BacktestMetadataRecord } from '../types';
import { TRADING_EVENT_SOURCE } from '../types';
import type { BotUpdatedDetail } from '../types';

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

/** Fields that support explicit `null` to remove from DynamoDB. */
const NULLABLE_FIELDS = ['stopLoss', 'takeProfit'];

/**
 * Updates an existing bot. Supports updating name, pair, status, executionMode,
 * buyQuery, sellQuery, cooldownMinutes, buySizing, sellSizing, stopLoss,
 * and takeProfit.
 *
 * When `executionMode` is changed, execution state fields (lastAction,
 * buyCooldownUntil, sellCooldownUntil) are automatically cleared to give
 * the bot a clean start under the new mode.
 *
 * Nullable fields (stopLoss, takeProfit) can be explicitly set to `null`
 * to remove them from the bot record. Position sizing (buySizing,
 * sellSizing) is mandatory when the corresponding query is present.
 *
 * Publishes a BotUpdated event to EventBridge with previous status and
 * whether queries changed.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with the updated bot attributes.
 */
export async function updateBot(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const botId = event.pathParameters?.botId;
  if (!botId) return jsonResponse(400, { error: 'Missing botId' });

  const body = JSON.parse(event.body ?? '{}');

  // Validate executionMode if provided
  if (body.executionMode !== undefined
    && body.executionMode !== 'once_and_wait'
    && body.executionMode !== 'condition_cooldown') {
    return jsonResponse(400, { error: 'executionMode must be once_and_wait or condition_cooldown' });
  }

  // Validate sizing configs
  const buySizingError = validateSizing(body.buySizing, 'buySizing');
  if (buySizingError) return jsonResponse(400, { error: buySizingError });

  const sellSizingError = validateSizing(body.sellSizing, 'sellSizing');
  if (sellSizingError) return jsonResponse(400, { error: sellSizingError });

  // Validate stop-loss and take-profit
  const slError = validateStopLoss(body.stopLoss);
  if (slError) return jsonResponse(400, { error: slError });

  const tpError = validateTakeProfit(body.takeProfit);
  if (tpError) return jsonResponse(400, { error: tpError });

  const allowedFields = [
    'name', 'pair', 'status', 'executionMode', 'buyQuery', 'sellQuery',
    'cooldownMinutes', 'buySizing', 'sellSizing', 'stopLoss', 'takeProfit',
  ];
  const updates: string[] = [];
  const removes: string[] = [];
  const names: Record<string, string> = { '#sub': 'sub' };
  const values: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      // Explicit null on nullable fields → REMOVE the attribute
      if (body[field] === null && NULLABLE_FIELDS.includes(field)) {
        removes.push(`#${field}`);
        names[`#${field}`] = field;
        continue;
      }
      const attrName = `#${field}`;
      const attrValue = `:${field}`;
      updates.push(`${attrName} = ${attrValue}`);
      names[attrName] = field;
      values[attrValue] = body[field];
    }
  }

  if (updates.length === 0 && removes.length === 0) {
    return jsonResponse(400, { error: 'No valid fields to update' });
  }

  // Validate cooldownMinutes if provided
  if (body.cooldownMinutes !== undefined && body.cooldownMinutes !== null
    && (typeof body.cooldownMinutes !== 'number' || body.cooldownMinutes < 0)) {
    return jsonResponse(400, { error: 'cooldownMinutes must be a non-negative number' });
  }

  // Fetch current bot for event context and validation
  const current = await ddbDoc.send(new GetCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub, botId },
  }));

  if (!current.Item) return jsonResponse(404, { error: 'Bot not found' });
  const currentBot = current.Item as BotRecord;

  // Validate once_and_wait requires both queries
  const targetMode = body.executionMode ?? currentBot.executionMode;
  const resultingBuy = body.buyQuery !== undefined ? body.buyQuery : currentBot.buyQuery;
  const resultingSell = body.sellQuery !== undefined ? body.sellQuery : currentBot.sellQuery;

  if (targetMode === 'once_and_wait' && (!resultingBuy || !resultingSell)) {
    return jsonResponse(400, { error: 'once_and_wait mode requires both buyQuery and sellQuery' });
  }

  // Sizing is mandatory when the corresponding action has a query
  const resultingBuySizing = body.buySizing !== undefined ? body.buySizing : currentBot.buySizing;
  const resultingSellSizing = body.sellSizing !== undefined ? body.sellSizing : currentBot.sellSizing;
  if (resultingBuy && !resultingBuySizing) {
    return jsonResponse(400, { error: 'buySizing is required when buyQuery is present' });
  }
  if (resultingSell && !resultingSellSizing) {
    return jsonResponse(400, { error: 'sellSizing is required when sellQuery is present' });
  }

  // When executionMode changes, clear execution state for a clean start
  if (body.executionMode !== undefined) {
    removes.push('#lastAction', '#buyCooldownUntil', '#sellCooldownUntil');
    names['#lastAction'] = 'lastAction';
    names['#buyCooldownUntil'] = 'buyCooldownUntil';
    names['#sellCooldownUntil'] = 'sellCooldownUntil';
  }

  // When both stopLoss and takeProfit are removed, clear entryPrice
  const resultingSL = body.stopLoss !== undefined ? body.stopLoss : currentBot.stopLoss;
  const resultingTP = body.takeProfit !== undefined ? body.takeProfit : currentBot.takeProfit;
  if (!resultingSL && !resultingTP && currentBot.entryPrice !== undefined) {
    removes.push('#entryPrice');
    names['#entryPrice'] = 'entryPrice';
  }

  // Always update updatedAt
  updates.push('#updatedAt = :updatedAt');
  names['#updatedAt'] = 'updatedAt';
  values[':updatedAt'] = new Date().toISOString();

  let updateExpression = `SET ${updates.join(', ')}`;
  if (removes.length > 0) {
    updateExpression += ` REMOVE ${removes.join(', ')}`;
  }

  try {
    const result = await ddbDoc.send(new UpdateCommand({
      TableName: process.env.BOTS_TABLE_NAME!,
      Key: { sub, botId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(#sub)',
      ReturnValues: 'ALL_NEW',
    }));

    const updatedBot = result.Attributes as BotRecord;

    // Publish BotUpdated event and check if bot rules or SL/TP config changed
    const queriesChanged = JSON.stringify(currentBot.buyQuery) !== JSON.stringify(updatedBot.buyQuery)
      || JSON.stringify(currentBot.sellQuery) !== JSON.stringify(updatedBot.sellQuery)
      || JSON.stringify(currentBot.stopLoss) !== JSON.stringify(updatedBot.stopLoss)
      || JSON.stringify(currentBot.takeProfit) !== JSON.stringify(updatedBot.takeProfit);

    try {
      await eventBridge.send(new PutEventsCommand({
        Entries: [{
          Source: TRADING_EVENT_SOURCE,
          DetailType: 'BotUpdated',
          Detail: JSON.stringify({
            bot: updatedBot,
            previousStatus: currentBot.status,
            queriesChanged,
          } satisfies BotUpdatedDetail),
        }],
      }));
    } catch (err) {
      console.error('Failed to publish BotUpdated event:', err);
    }

    // Mark existing backtests as stale when buy/sell rules change
    if (queriesChanged && process.env.BACKTESTS_TABLE_NAME) {
      try {
        const backtestResults = await ddbDoc.send(new QueryCommand({
          TableName: process.env.BACKTESTS_TABLE_NAME,
          IndexName: 'botId-index',
          KeyConditionExpression: 'botId = :botId',
          ExpressionAttributeValues: { ':botId': botId },
        }));

        const backtests = (backtestResults.Items ?? []) as BacktestMetadataRecord[];
        await Promise.all(backtests.map((bt) =>
          ddbDoc.send(new UpdateCommand({
            TableName: process.env.BACKTESTS_TABLE_NAME!,
            Key: { sub, backtestId: bt.backtestId },
            UpdateExpression: 'SET configChangedSinceTest = :changed',
            ExpressionAttributeValues: { ':changed': true },
          })),
        ));
      } catch (err) {
        console.error('Failed to invalidate backtest records:', err);
      }
    }

    return jsonResponse(200, updatedBot);
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return jsonResponse(404, { error: 'Bot not found' });
    }
    throw err;
  }
}
