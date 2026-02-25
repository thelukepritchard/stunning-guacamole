import type { SNSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { evaluateRuleGroup } from '../rule-evaluator';
import type { BotAction, BotRecord, IndicatorSnapshot, TradeRecord } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Records a trade signal to the trades table.
 *
 * @param bot - The bot that triggered the trade.
 * @param action - The trade action (buy or sell).
 * @param indicators - The current indicator snapshot.
 */
async function recordTrade(bot: BotRecord, action: BotAction, indicators: IndicatorSnapshot): Promise<void> {
  const trade: TradeRecord = {
    botId: bot.botId,
    timestamp: new Date().toISOString(),
    sub: bot.sub,
    pair: bot.pair,
    action,
    price: indicators.price,
    indicators,
    createdAt: new Date().toISOString(),
  };

  await ddbDoc.send(new PutCommand({
    TableName: process.env.TRADES_TABLE_NAME!,
    Item: trade,
  }));

  console.log(`${action.charAt(0).toUpperCase() + action.slice(1)} trade signal recorded:`, { botId: bot.botId, price: indicators.price });
}

/**
 * Attempts an atomic conditional update on the bot record. Returns true
 * if the update succeeded (condition was met), false if it was rejected
 * (ConditionalCheckFailedException). Re-throws all other errors.
 *
 * @param params - The UpdateCommand input parameters.
 * @returns True if the update was applied.
 */
async function tryConditionalUpdate(params: ConstructorParameters<typeof UpdateCommand>[0]): Promise<boolean> {
  try {
    await ddbDoc.send(new UpdateCommand(params));
    return true;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw err;
  }
}

/**
 * Determines whether a specific action is allowed under the once_and_wait
 * execution mode.
 *
 * The bot fires once, then locks until the counter-action fires.
 * - If lastAction is undefined (fresh bot), both actions can fire.
 * - If lastAction is 'buy', only 'sell' can fire (and vice versa).
 *
 * @param action - The action to check.
 * @param lastAction - The last action that fired.
 * @returns True if the action is allowed.
 */
function isAllowedOnceAndWait(action: BotAction, lastAction?: BotAction): boolean {
  if (!lastAction) return true;
  return lastAction !== action;
}

/**
 * Executes once_and_wait mode logic for a bot.
 *
 * Evaluates buy/sell queries, respecting the lastAction lock. Only the
 * first matching action is recorded (buy is checked first). Uses a
 * conditional write to atomically claim the action before recording
 * the trade, preventing duplicate trades from concurrent invocations.
 *
 * @param bot - The bot record.
 * @param indicators - The current indicator snapshot.
 */
async function executeOnceAndWait(bot: BotRecord, indicators: IndicatorSnapshot): Promise<void> {
  let firedAction: BotAction | undefined;

  // Evaluate buy rules
  if (bot.buyQuery
    && isAllowedOnceAndWait('buy', bot.lastAction)
    && evaluateRuleGroup(bot.buyQuery, indicators)) {
    // Atomically claim the action — only one invocation wins
    const claimed = await tryConditionalUpdate({
      TableName: process.env.BOTS_TABLE_NAME!,
      Key: { sub: bot.sub, botId: bot.botId },
      UpdateExpression: 'SET lastAction = :action',
      ConditionExpression: 'attribute_not_exists(lastAction) OR lastAction <> :action',
      ExpressionAttributeValues: { ':action': 'buy' },
    });
    if (claimed) {
      await recordTrade(bot, 'buy', indicators);
      firedAction = 'buy';
    }
  }

  // Evaluate sell rules (only if buy didn't fire — one action per cycle)
  if (!firedAction
    && bot.sellQuery
    && isAllowedOnceAndWait('sell', bot.lastAction)
    && evaluateRuleGroup(bot.sellQuery, indicators)) {
    const claimed = await tryConditionalUpdate({
      TableName: process.env.BOTS_TABLE_NAME!,
      Key: { sub: bot.sub, botId: bot.botId },
      UpdateExpression: 'SET lastAction = :action',
      ConditionExpression: 'attribute_not_exists(lastAction) OR lastAction <> :action',
      ExpressionAttributeValues: { ':action': 'sell' },
    });
    if (claimed) {
      await recordTrade(bot, 'sell', indicators);
    }
  }
}

/**
 * Attempts to execute a single action (buy or sell) under condition_cooldown mode.
 *
 * If cooldownMinutes is configured, atomically sets the per-action cooldownUntil
 * timestamp before recording the trade. Without cooldown, records directly.
 *
 * @param bot - The bot record.
 * @param action - The action to attempt (buy or sell).
 * @param indicators - The current indicator snapshot.
 * @returns True if a trade was recorded.
 */
async function tryConditionCooldownAction(
  bot: BotRecord,
  action: BotAction,
  indicators: IndicatorSnapshot,
): Promise<boolean> {
  const cooldownField = action === 'buy' ? 'buyCooldownUntil' : 'sellCooldownUntil';
  const hasCooldown = bot.cooldownMinutes !== undefined && bot.cooldownMinutes > 0;

  if (hasCooldown) {
    const now = new Date().toISOString();
    const claimed = await tryConditionalUpdate({
      TableName: process.env.BOTS_TABLE_NAME!,
      Key: { sub: bot.sub, botId: bot.botId },
      UpdateExpression: 'SET #cd = :cd',
      ConditionExpression: 'attribute_not_exists(#cd) OR #cd <= :now',
      ExpressionAttributeNames: { '#cd': cooldownField },
      ExpressionAttributeValues: {
        ':cd': new Date(Date.now() + bot.cooldownMinutes! * 60_000).toISOString(),
        ':now': now,
      },
    });
    if (claimed) {
      await recordTrade(bot, action, indicators);
      return true;
    }
    return false;
  }

  await recordTrade(bot, action, indicators);
  return true;
}

/**
 * Executes condition_cooldown mode logic for a bot.
 *
 * Buy and sell actions are evaluated independently with per-action cooldowns:
 * - If `buyCooldownUntil` > now → skip buy evaluation
 * - If `sellCooldownUntil` > now → skip sell evaluation
 * - If rules match and cooldown is clear → atomically set cooldownUntil
 *   (if configured) + record trade
 *
 * When cooldownMinutes is configured, a trade sets a per-action
 * cooldownUntil timestamp that prevents that action from re-firing
 * until the cooldown expires. Buy and sell cooldowns are independent.
 *
 * Uses conditional writes to atomically set cooldownUntil before recording
 * a trade. This prevents duplicate trades from concurrent invocations
 * or SNS at-least-once delivery retries.
 *
 * @param bot - The bot record.
 * @param indicators - The current indicator snapshot.
 */
async function executeConditionCooldown(bot: BotRecord, indicators: IndicatorSnapshot): Promise<void> {
  const now = Date.now();

  // Evaluate buy action (skip if buy cooldown is active)
  const buyInCooldown = bot.buyCooldownUntil && new Date(bot.buyCooldownUntil).getTime() > now;
  if (!buyInCooldown && bot.buyQuery && evaluateRuleGroup(bot.buyQuery, indicators)) {
    await tryConditionCooldownAction(bot, 'buy', indicators);
  }

  // Evaluate sell action (skip if sell cooldown is active)
  const sellInCooldown = bot.sellCooldownUntil && new Date(bot.sellCooldownUntil).getTime() > now;
  if (!sellInCooldown && bot.sellQuery && evaluateRuleGroup(bot.sellQuery, indicators)) {
    await tryConditionCooldownAction(bot, 'sell', indicators);
  }
}

/**
 * SNS-triggered Lambda that evaluates a bot's buy and sell rule trees
 * against incoming indicator data. Execution behaviour depends on the
 * bot's configured execution mode:
 *
 * - **once_and_wait**: Fires once, then locked until the counter-action fires.
 * - **condition_cooldown**: Fires when conditions match. Optionally enforces
 *   a minimum time between trades per action via `cooldownMinutes`, with
 *   independent `buyCooldownUntil` and `sellCooldownUntil` timestamps.
 *
 * State transitions use DynamoDB conditional writes to guarantee
 * at-most-once trade recording per trigger, even under concurrent
 * Lambda invocations or SNS at-least-once delivery retries.
 *
 * @param event - The SNS event containing indicator data.
 */
export async function handler(event: SNSEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      const subscriptionArn = record.EventSubscriptionArn;
      const indicators: IndicatorSnapshot = JSON.parse(record.Sns.Message);

      // Look up bot by subscription ARN (GSI is eventually consistent)
      const gsiResult = await ddbDoc.send(new QueryCommand({
        TableName: process.env.BOTS_TABLE_NAME!,
        IndexName: 'subscriptionArn-index',
        KeyConditionExpression: 'subscriptionArn = :arn',
        ExpressionAttributeValues: { ':arn': subscriptionArn },
        ProjectionExpression: '#sub, botId',
        ExpressionAttributeNames: { '#sub': 'sub' },
      }));

      const gsiItem = gsiResult.Items?.[0] as { sub: string; botId: string } | undefined;
      if (!gsiItem) {
        console.log('Bot not found or not active:', { subscriptionArn });
        continue;
      }

      // Fetch full bot with strongly consistent read to get latest execution state
      const botResult = await ddbDoc.send(new GetCommand({
        TableName: process.env.BOTS_TABLE_NAME!,
        Key: { sub: gsiItem.sub, botId: gsiItem.botId },
        ConsistentRead: true,
      }));

      const bot = botResult.Item as BotRecord | undefined;
      if (!bot || bot.status !== 'active') {
        console.log('Bot not found or not active:', { subscriptionArn });
        continue;
      }

      switch (bot.executionMode) {
        case 'once_and_wait':
          await executeOnceAndWait(bot, indicators);
          break;
        case 'condition_cooldown':
          await executeConditionCooldown(bot, indicators);
          break;
        default:
          console.log('Unknown execution mode:', { botId: bot.botId, executionMode: bot.executionMode });
      }
    } catch (err) {
      // Log and continue — do not throw so SNS does not retry the entire batch
      console.error('Error processing record:', err);
    }
  }
}
