import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { jsonResponse } from '../utils';
import type { BotRecord } from '../types';
import { TRADING_EVENT_SOURCE } from '../types';
import type { BotUpdatedDetail } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});

/**
 * Updates an existing bot. Supports updating name, pair, status, executionMode,
 * buyQuery, sellQuery, and cooldownMinutes.
 *
 * When `executionMode` is changed, execution state fields (lastAction,
 * buyCooldownUntil, sellCooldownUntil) are automatically cleared to give
 * the bot a clean start under the new mode.
 *
 * Publishes a BotUpdated event to EventBridge with previous status and
 * whether queries changed, enabling the lifecycle handler to manage
 * SNS subscriptions.
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

  const allowedFields = ['name', 'pair', 'status', 'executionMode', 'buyQuery', 'sellQuery', 'cooldownMinutes'];
  const updates: string[] = [];
  const removes: string[] = [];
  const names: Record<string, string> = { '#sub': 'sub' };
  const values: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      const attrName = `#${field}`;
      const attrValue = `:${field}`;
      updates.push(`${attrName} = ${attrValue}`);
      names[attrName] = field;
      values[attrValue] = body[field];
    }
  }

  if (updates.length === 0) {
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

  // When executionMode changes, clear execution state for a clean start
  if (body.executionMode !== undefined) {
    removes.push('#lastAction', '#buyCooldownUntil', '#sellCooldownUntil');
    names['#lastAction'] = 'lastAction';
    names['#buyCooldownUntil'] = 'buyCooldownUntil';
    names['#sellCooldownUntil'] = 'sellCooldownUntil';
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

    // Publish BotUpdated event
    const queriesChanged = JSON.stringify(currentBot.buyQuery) !== JSON.stringify(updatedBot.buyQuery)
      || JSON.stringify(currentBot.sellQuery) !== JSON.stringify(updatedBot.sellQuery);

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

    return jsonResponse(200, updatedBot);
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return jsonResponse(404, { error: 'Bot not found' });
    }
    throw err;
  }
}
