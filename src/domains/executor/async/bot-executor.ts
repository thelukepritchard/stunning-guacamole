import type { SNSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { evaluateRuleGroup } from '../../shared/rule-evaluator';
import type { BotAction, BotRecord, IndicatorSnapshot, SizingConfig, TradeTrigger, TradeRecord, DemoOrderRecord } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const DEMO_EXCHANGE_API_URL = process.env.DEMO_EXCHANGE_API_URL!;

/**
 * Queries all active bots for a given trading pair using the pair-status GSI.
 * Returns fully-hydrated bot records via strongly consistent reads.
 *
 * @param pair - The coin ticker (e.g. "BTC").
 * @returns All active bot records for the pair.
 */
async function queryActiveBotsByPair(pair: string): Promise<BotRecord[]> {
  const keys: { sub: string; botId: string }[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddbDoc.send(new QueryCommand({
      TableName: process.env.BOTS_TABLE_NAME!,
      IndexName: 'pair-status-index',
      KeyConditionExpression: '#pair = :pair AND #status = :active',
      ExpressionAttributeNames: { '#pair': 'pair', '#status': 'status', '#sub': 'sub' },
      ExpressionAttributeValues: { ':pair': pair, ':active': 'active' },
      ProjectionExpression: '#sub, botId',
      ExclusiveStartKey: lastKey,
    }));
    keys.push(...(result.Items as { sub: string; botId: string }[] ?? []));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  // Fetch full records with strongly consistent reads for latest execution state
  const bots: BotRecord[] = [];
  for (const key of keys) {
    const result = await ddbDoc.send(new GetCommand({
      TableName: process.env.BOTS_TABLE_NAME!,
      Key: { sub: key.sub, botId: key.botId },
      ConsistentRead: true,
    }));
    const bot = result.Item as BotRecord | undefined;
    if (bot && bot.status === 'active') {
      bots.push(bot);
    }
  }

  return bots;
}

/**
 * Fetches the user's current demo exchange balance.
 *
 * @param sub - The user's Cognito sub.
 * @returns The user's USD and BTC balances.
 */
async function fetchDemoBalance(sub: string): Promise<{ usd: number; btc: number }> {
  const url = `${DEMO_EXCHANGE_API_URL}demo-exchange/balance?sub=${encodeURIComponent(sub)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch demo balance: ${res.status}`);
  }
  return (await res.json()) as { usd: number; btc: number };
}

/**
 * Calculates the order size in BTC based on the bot's sizing configuration.
 *
 * - Fixed sizing: converts the dollar amount to BTC at the current price.
 * - Percentage sizing: fetches the current balance and computes the fraction.
 *   For buys, percentage is applied to available USD. For sells, to held BTC.
 *
 * @param sub - The user's Cognito sub.
 * @param action - The trade action (buy or sell).
 * @param sizing - Position sizing configuration.
 * @param price - The current BTC price.
 * @returns The order size in BTC.
 */
async function calculateOrderSize(
  sub: string,
  action: BotAction,
  sizing: SizingConfig,
  price: number,
): Promise<number> {
  if (sizing.type === 'fixed') {
    return sizing.value / price;
  }

  // Percentage sizing — need current balance
  const balance = await fetchDemoBalance(sub);

  if (action === 'buy') {
    const dollarAmount = balance.usd * (sizing.value / 100);
    return dollarAmount / price;
  }
  return balance.btc * (sizing.value / 100);
}

/** Result of a demo exchange order placement. */
interface OrderResult {
  status: 'filled' | 'failed';
  orderId?: string;
  failReason?: string;
}

/**
 * Places a market order on the demo exchange via the internal API.
 * Parses the response to determine order outcome (filled or failed).
 * Logs errors but does not throw — exchange execution failures should
 * not prevent trade signal recording.
 *
 * @param sub - The user's Cognito sub.
 * @param pair - The trading pair (e.g. "BTC").
 * @param side - The order side ("buy" or "sell").
 * @param size - The order size in BTC.
 * @returns The order result with status and optional orderId.
 */
async function placeExchangeOrder(sub: string, pair: string, side: BotAction, size: number): Promise<OrderResult> {
  const url = `${DEMO_EXCHANGE_API_URL}demo-exchange/orders`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sub, pair, side, size }),
  });

  const body = await res.json() as Partial<DemoOrderRecord>;
  const orderStatus = body.status === 'filled' ? 'filled' as const : 'failed' as const;

  if (orderStatus === 'failed') {
    console.error('Demo exchange order failed:', { status: res.status, sub, pair, side, size, failReason: body.failReason });
  } else {
    console.log('Demo exchange order placed:', { sub, pair, side, size, orderId: body.orderId });
  }

  return { status: orderStatus, orderId: body.orderId, failReason: body.failReason };
}

/** Result of exchange execution, including order tracking fields. */
interface ExchangeResult {
  orderStatus: 'filled' | 'failed' | 'skipped';
  orderId?: string;
  failReason?: string;
}

/**
 * Executes a trade on the demo exchange using the bot's sizing config.
 * Calculates the order size and places the order. If no sizing is
 * configured, logs a warning and skips execution.
 *
 * Catches all errors internally — exchange execution failures must not
 * prevent trade signal recording or leave the bot in an inconsistent state.
 *
 * @param bot - The bot record.
 * @param action - The trade action (buy or sell).
 * @param price - The current market price.
 * @returns The exchange execution result with orderStatus and optional orderId.
 */
async function executeOnExchange(bot: BotRecord, action: BotAction, price: number): Promise<ExchangeResult> {
  const sizing = action === 'buy' ? bot.buySizing : bot.sellSizing;

  if (!sizing) {
    console.warn('No sizing configured, skipping exchange execution:', { botId: bot.botId, action });
    return { orderStatus: 'skipped' };
  }

  if (!price || price <= 0) {
    console.warn('Invalid price for order size calculation:', { botId: bot.botId, action, price });
    return { orderStatus: 'skipped' };
  }

  try {
    const size = await calculateOrderSize(bot.sub, action, sizing, price);
    if (size <= 0) {
      console.warn('Calculated order size is zero or negative, skipping:', { botId: bot.botId, action, size });
      return { orderStatus: 'skipped' };
    }

    const result = await placeExchangeOrder(bot.sub, bot.pair, action, size);
    return { orderStatus: result.status, orderId: result.orderId, failReason: result.failReason };
  } catch (err) {
    console.error('Exchange execution failed:', { botId: bot.botId, action }, err);
    return { orderStatus: 'skipped' };
  }
}

/**
 * Records a trade signal to the trades table.
 *
 * @param bot - The bot that triggered the trade.
 * @param action - The trade action (buy or sell).
 * @param trigger - What caused the trade (rule, stop_loss, take_profit).
 * @param indicators - The current indicator snapshot.
 * @param sizing - Optional position sizing configuration.
 * @param exchangeResult - Optional exchange execution result (orderStatus + orderId).
 */
async function recordTrade(
  bot: BotRecord,
  action: BotAction,
  trigger: TradeTrigger,
  indicators: IndicatorSnapshot,
  sizing?: SizingConfig,
  exchangeResult?: ExchangeResult,
): Promise<void> {
  const trade: TradeRecord = {
    botId: bot.botId,
    timestamp: new Date().toISOString(),
    sub: bot.sub,
    pair: bot.pair,
    action,
    price: indicators.price,
    trigger,
    indicators,
    createdAt: new Date().toISOString(),
  };

  if (sizing) trade.sizing = sizing;
  if (exchangeResult?.orderStatus) trade.orderStatus = exchangeResult.orderStatus;
  if (exchangeResult?.orderId) trade.orderId = exchangeResult.orderId;
  if (exchangeResult?.failReason) trade.failReason = exchangeResult.failReason;

  await ddbDoc.send(new PutCommand({
    TableName: process.env.TRADES_TABLE_NAME!,
    Item: trade,
  }));

  console.log(`${action.charAt(0).toUpperCase() + action.slice(1)} trade signal recorded:`, {
    botId: bot.botId, price: indicators.price, trigger, orderStatus: exchangeResult?.orderStatus,
  });
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
 * Updates the bot's entry price after a trade. Sets entryPrice on buy,
 * clears it on sell.
 *
 * @param bot - The bot record.
 * @param action - The trade action that just fired.
 * @param price - The trade price.
 */
async function updateEntryPrice(bot: BotRecord, action: BotAction, price: number): Promise<void> {
  if (action === 'buy') {
    await ddbDoc.send(new UpdateCommand({
      TableName: process.env.BOTS_TABLE_NAME!,
      Key: { sub: bot.sub, botId: bot.botId },
      UpdateExpression: 'SET entryPrice = :price',
      ExpressionAttributeValues: { ':price': price },
    }));
  } else {
    await ddbDoc.send(new UpdateCommand({
      TableName: process.env.BOTS_TABLE_NAME!,
      Key: { sub: bot.sub, botId: bot.botId },
      UpdateExpression: 'REMOVE entryPrice',
    }));
  }
}

/**
 * Evaluates stop-loss and take-profit conditions against the current price.
 * Returns the trigger type if a SL/TP condition is met, or undefined otherwise.
 *
 * Requires an entry price on the bot (set when a buy trade fires). If there
 * is no entry price, SL/TP cannot be evaluated.
 *
 * @param bot - The bot record (with entryPrice, stopLoss, takeProfit).
 * @param currentPrice - The current market price.
 * @returns The trigger type ('stop_loss' or 'take_profit') or undefined.
 */
function evaluateStopLossTakeProfit(bot: BotRecord, currentPrice: number): TradeTrigger | undefined {
  if (bot.entryPrice === undefined) return undefined;

  // Check stop-loss: price dropped below threshold
  if (bot.stopLoss) {
    const slPrice = bot.entryPrice * (1 - bot.stopLoss.percentage / 100);
    if (currentPrice <= slPrice) return 'stop_loss';
  }

  // Check take-profit: price rose above threshold
  if (bot.takeProfit) {
    const tpPrice = bot.entryPrice * (1 + bot.takeProfit.percentage / 100);
    if (currentPrice >= tpPrice) return 'take_profit';
  }

  return undefined;
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
  if (!lastAction) return action === 'buy';
  return lastAction !== action;
}

/**
 * Executes once_and_wait mode logic for a single action.
 *
 * For sell actions, evaluates stop-loss/take-profit first — if triggered,
 * the trade fires immediately without evaluating the sell query. Otherwise
 * evaluates the action's query, respecting the lastAction lock.
 *
 * Uses a conditional write to atomically claim the action before recording
 * the trade, preventing duplicate trades from concurrent invocations.
 * After recording, updates entry price (set on buy, clear on sell).
 *
 * @param bot - The bot record.
 * @param action - The action to evaluate (buy or sell).
 * @param indicators - The current indicator snapshot.
 */
async function executeOnceAndWait(bot: BotRecord, action: BotAction, indicators: IndicatorSnapshot): Promise<void> {
  if (!isAllowedOnceAndWait(action, bot.lastAction)) return;

  let trigger: TradeTrigger = 'rule';

  // For sell actions, check SL/TP before rule evaluation
  if (action === 'sell') {
    const sltp = evaluateStopLossTakeProfit(bot, indicators.price);
    if (sltp) {
      trigger = sltp;
    } else {
      // No SL/TP hit — fall through to rule evaluation
      const query = bot.sellQuery;
      if (!query || !evaluateRuleGroup(query, indicators)) return;
    }
  } else {
    const query = bot.buyQuery;
    if (!query || !evaluateRuleGroup(query, indicators)) return;
  }

  const sizing = action === 'buy' ? bot.buySizing : bot.sellSizing;

  // Atomically claim the action — only one invocation wins
  const claimed = await tryConditionalUpdate({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub: bot.sub, botId: bot.botId },
    UpdateExpression: 'SET lastAction = :action',
    ConditionExpression: 'attribute_not_exists(lastAction) OR lastAction <> :action',
    ExpressionAttributeValues: { ':action': action },
  });

  if (claimed) {
    const exchangeResult = await executeOnExchange(bot, action, indicators.price);
    await recordTrade(bot, action, trigger, indicators, sizing, exchangeResult);

    if (exchangeResult.orderStatus === 'filled') {
      await updateEntryPrice(bot, action, indicators.price);
    } else {
      // Order was not filled — revert the lastAction claim so the bot can retry
      if (bot.lastAction) {
        await ddbDoc.send(new UpdateCommand({
          TableName: process.env.BOTS_TABLE_NAME!,
          Key: { sub: bot.sub, botId: bot.botId },
          UpdateExpression: 'SET lastAction = :prev',
          ExpressionAttributeValues: { ':prev': bot.lastAction },
        }));
      } else {
        await ddbDoc.send(new UpdateCommand({
          TableName: process.env.BOTS_TABLE_NAME!,
          Key: { sub: bot.sub, botId: bot.botId },
          UpdateExpression: 'REMOVE lastAction',
        }));
      }
    }
  }
}

/**
 * Attempts to execute a single action (buy or sell) under condition_cooldown mode.
 *
 * If cooldownMinutes is configured, atomically sets the per-action cooldownUntil
 * timestamp before recording the trade. Without cooldown, records directly.
 * After recording, updates entry price (set on buy, clear on sell).
 *
 * @param bot - The bot record.
 * @param action - The action to attempt (buy or sell).
 * @param trigger - What caused the trade (rule, stop_loss, take_profit).
 * @param indicators - The current indicator snapshot.
 * @returns True if a trade was recorded.
 */
async function tryConditionCooldownAction(
  bot: BotRecord,
  action: BotAction,
  trigger: TradeTrigger,
  indicators: IndicatorSnapshot,
): Promise<boolean> {
  const cooldownField = action === 'buy' ? 'buyCooldownUntil' : 'sellCooldownUntil';
  const hasCooldown = bot.cooldownMinutes !== undefined && bot.cooldownMinutes > 0;
  const sizing = action === 'buy' ? bot.buySizing : bot.sellSizing;

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
      const exchangeResult = await executeOnExchange(bot, action, indicators.price);
      await recordTrade(bot, action, trigger, indicators, sizing, exchangeResult);

      if (exchangeResult.orderStatus !== 'filled') {
        // Order not filled — revert cooldown so the bot can retry
        await ddbDoc.send(new UpdateCommand({
          TableName: process.env.BOTS_TABLE_NAME!,
          Key: { sub: bot.sub, botId: bot.botId },
          UpdateExpression: 'REMOVE #cd',
          ExpressionAttributeNames: { '#cd': cooldownField },
        }));
        return false;
      }

      await updateEntryPrice(bot, action, indicators.price);
      return true;
    }
    return false;
  }

  const exchangeResult = await executeOnExchange(bot, action, indicators.price);
  await recordTrade(bot, action, trigger, indicators, sizing, exchangeResult);

  if (exchangeResult.orderStatus === 'filled') {
    await updateEntryPrice(bot, action, indicators.price);
  }
  return exchangeResult.orderStatus === 'filled';
}

/**
 * Executes condition_cooldown mode logic for a single action.
 *
 * For sell actions, evaluates stop-loss/take-profit first — if triggered,
 * the trade fires immediately (bypassing cooldown and sell query).
 * Otherwise evaluates the action's query with per-action cooldown:
 * - If cooldownUntil > now → skip evaluation
 * - If rules match and cooldown is clear → atomically set cooldownUntil
 *   (if configured) + record trade
 *
 * @param bot - The bot record.
 * @param action - The action to evaluate (buy or sell).
 * @param indicators - The current indicator snapshot.
 */
async function executeConditionCooldown(bot: BotRecord, action: BotAction, indicators: IndicatorSnapshot): Promise<void> {
  // For sell actions, check SL/TP first — these bypass cooldown and query rules
  if (action === 'sell') {
    const sltp = evaluateStopLossTakeProfit(bot, indicators.price);
    if (sltp) {
      await tryConditionCooldownAction(bot, action, sltp, indicators);
      return;
    }
  }

  const query = action === 'buy' ? bot.buyQuery : bot.sellQuery;
  if (!query) return;

  const now = Date.now();
  const cooldownUntil = action === 'buy' ? bot.buyCooldownUntil : bot.sellCooldownUntil;
  const inCooldown = cooldownUntil && new Date(cooldownUntil).getTime() > now;

  if (inCooldown) return;

  if (evaluateRuleGroup(query, indicators)) {
    await tryConditionCooldownAction(bot, action, 'rule', indicators);
  }
}

/**
 * SNS-triggered Lambda that evaluates all active bots for the received
 * trading pair against incoming indicator data. A single static SNS
 * subscription delivers every indicator tick to this handler, which then
 * fans out to all active bots for the pair.
 *
 * For each bot, both buy and sell actions are evaluated independently.
 *
 * Execution behaviour depends on the bot's configured execution mode:
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
      const indicators: IndicatorSnapshot = JSON.parse(record.Sns.Message);
      const pair = record.Sns.MessageAttributes?.pair?.Value;
      if (!pair) {
        console.log('No pair attribute in SNS message, skipping');
        continue;
      }

      const bots = await queryActiveBotsByPair(pair);
      console.log(`Processing ${bots.length} active bots for pair ${pair}`);

      for (const bot of bots) {
        try {
          switch (bot.executionMode) {
            case 'once_and_wait':
              await executeOnceAndWait(bot, 'buy', indicators);
              await executeOnceAndWait(bot, 'sell', indicators);
              break;
            case 'condition_cooldown':
              await executeConditionCooldown(bot, 'buy', indicators);
              await executeConditionCooldown(bot, 'sell', indicators);
              break;
            default:
              console.log('Unknown execution mode:', { botId: bot.botId, executionMode: bot.executionMode });
          }
        } catch (err) {
          console.error('Error processing bot:', { botId: bot.botId }, err);
        }
      }
    } catch (err) {
      // Log and continue — do not throw so SNS does not retry the entire batch
      console.error('Error processing record:', err);
    }
  }
}
