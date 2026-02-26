import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { evaluateRuleGroup } from '../rule-evaluator';
import type {
  BotRecord, BotAction, IndicatorSnapshot, TradeTrigger,
  BacktestReport, BacktestSummary, HourlyBucket, BacktestSizingMode,
  SizingConfig, StopLossConfig, TakeProfitConfig, PriceHistoryRecord,
} from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Step Functions input for the engine step. */
interface EngineInput {
  backtestId: string;
  sub: string;
  botId: string;
  botConfigSnapshot: BotRecord;
  windowStart: string;
  windowEnd: string;
}

/** A simulated trade within the backtest engine. */
interface SimulatedTrade {
  timestamp: string;
  action: BotAction;
  price: number;
  trigger: TradeTrigger;
  sizing?: SizingConfig;
}

/** Simulated bot execution state tracked across ticks. */
interface SimulationState {
  lastAction?: BotAction;
  entryPrice?: number;
  buyCooldownUntil?: number;
  sellCooldownUntil?: number;
}

/** Default notional value when no sizing is configured ($1,000 AUD). */
const DEFAULT_NOTIONAL = 1000;

/**
 * Evaluates stop-loss and take-profit conditions against the current price.
 *
 * @param entryPrice - The simulated entry price.
 * @param currentPrice - The current tick price.
 * @param stopLoss - Stop-loss config from bot.
 * @param takeProfit - Take-profit config from bot.
 * @returns The trigger type or undefined.
 */
function evaluateStopLossTakeProfit(
  entryPrice: number,
  currentPrice: number,
  stopLoss?: StopLossConfig,
  takeProfit?: TakeProfitConfig,
): TradeTrigger | undefined {
  if (stopLoss) {
    const slPrice = entryPrice * (1 - stopLoss.percentage / 100);
    if (currentPrice <= slPrice) return 'stop_loss';
  }
  if (takeProfit) {
    const tpPrice = entryPrice * (1 + takeProfit.percentage / 100);
    if (currentPrice >= tpPrice) return 'take_profit';
  }
  return undefined;
}

/**
 * Attempts to execute a trade action for the given tick, respecting execution
 * mode, cooldowns, stop-loss/take-profit, and query rules. Mirrors the live
 * bot-executor logic but operates on in-memory state instead of DynamoDB.
 *
 * @param bot - The bot configuration snapshot.
 * @param action - The action to attempt.
 * @param indicators - The current tick's indicator snapshot.
 * @param tickTime - Epoch ms of the current tick.
 * @param state - Mutable simulation state.
 * @returns A simulated trade if one fires, or undefined.
 */
function tryExecute(
  bot: BotRecord,
  action: BotAction,
  indicators: IndicatorSnapshot,
  tickTime: number,
  state: SimulationState,
): SimulatedTrade | undefined {
  const price = indicators.price;

  if (bot.executionMode === 'once_and_wait') {
    // Check if action is allowed
    if (state.lastAction && state.lastAction === action) return undefined;

    let trigger: TradeTrigger = 'rule';

    if (action === 'sell') {
      // Check SL/TP first
      if (state.entryPrice !== undefined) {
        const sltp = evaluateStopLossTakeProfit(state.entryPrice, price, bot.stopLoss, bot.takeProfit);
        if (sltp) {
          trigger = sltp;
        } else {
          // Evaluate sell query
          if (!bot.sellQuery || !evaluateRuleGroup(bot.sellQuery, indicators)) return undefined;
        }
      } else {
        // No entry price — evaluate sell query
        if (!bot.sellQuery || !evaluateRuleGroup(bot.sellQuery, indicators)) return undefined;
      }
    } else {
      if (!bot.buyQuery || !evaluateRuleGroup(bot.buyQuery, indicators)) return undefined;
    }

    const sizing = action === 'buy' ? bot.buySizing : bot.sellSizing;

    // Update state
    state.lastAction = action;
    if (action === 'buy') {
      state.entryPrice = price;
    } else {
      state.entryPrice = undefined;
    }

    return { timestamp: new Date(tickTime).toISOString(), action, price, trigger, sizing };
  }

  // condition_cooldown mode — check SL/TP first for sell actions (bypasses cooldown and query)
  if (action === 'sell' && state.entryPrice !== undefined) {
    const sltp = evaluateStopLossTakeProfit(state.entryPrice, price, bot.stopLoss, bot.takeProfit);
    if (sltp) {
      const sizing = bot.sellSizing;
      state.entryPrice = undefined;
      return { timestamp: new Date(tickTime).toISOString(), action, price, trigger: sltp, sizing };
    }
  }

  // Check cooldown
  const cooldownUntil = action === 'buy' ? state.buyCooldownUntil : state.sellCooldownUntil;
  if (cooldownUntil && tickTime < cooldownUntil) return undefined;

  const query = action === 'buy' ? bot.buyQuery : bot.sellQuery;
  if (!query) return undefined;

  if (!evaluateRuleGroup(query, indicators)) return undefined;

  const sizing = action === 'buy' ? bot.buySizing : bot.sellSizing;

  // Set cooldown
  if (bot.cooldownMinutes && bot.cooldownMinutes > 0) {
    const cooldownField = action === 'buy' ? 'buyCooldownUntil' : 'sellCooldownUntil';
    (state as Record<string, unknown>)[cooldownField] = tickTime + bot.cooldownMinutes * 60_000;
  }

  // Update entry price
  if (action === 'buy') {
    state.entryPrice = price;
  } else {
    state.entryPrice = undefined;
  }

  return { timestamp: new Date(tickTime).toISOString(), action, price, trigger: 'rule', sizing };
}

/**
 * Calculates the realised P&L for a completed buy→sell pair.
 *
 * @param buyPrice - The buy entry price.
 * @param sellPrice - The sell exit price.
 * @param sizing - The sizing config used (or undefined for default).
 * @param sizingMode - Whether configured or default sizing is in use.
 * @returns The realised P&L value.
 */
function calculatePairPnl(
  buyPrice: number,
  sellPrice: number,
  sizing: SizingConfig | undefined,
  sizingMode: BacktestSizingMode,
): number {
  let quantity: number;
  if (sizingMode === 'configured' && sizing) {
    // For fixed sizing, quantity = value / buyPrice
    // For percentage, treat value as a notional amount
    quantity = sizing.type === 'fixed' ? sizing.value / buyPrice : (sizing.value * DEFAULT_NOTIONAL / 100) / buyPrice;
  } else {
    quantity = DEFAULT_NOTIONAL / buyPrice;
  }
  return quantity * (sellPrice - buyPrice);
}

/**
 * Fetches all price history records for a pair within a time window.
 * Handles pagination for large result sets.
 *
 * @param pair - The trading pair (e.g. 'BTC/USDT').
 * @param windowStart - ISO timestamp of window start.
 * @param windowEnd - ISO timestamp of window end.
 * @returns Array of price history records sorted chronologically.
 */
async function fetchPriceHistory(pair: string, windowStart: string, windowEnd: string): Promise<PriceHistoryRecord[]> {
  const records: PriceHistoryRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await ddbDoc.send(new QueryCommand({
      TableName: process.env.PRICE_HISTORY_TABLE_NAME!,
      KeyConditionExpression: '#pair = :pair AND #ts BETWEEN :start AND :end',
      ExpressionAttributeNames: { '#pair': 'pair', '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pair': pair,
        ':start': windowStart,
        ':end': windowEnd,
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    records.push(...(result.Items ?? []) as PriceHistoryRecord[]);
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return records;
}

/**
 * Groups price history ticks into hourly buckets of up to 60 ticks each.
 *
 * @param ticks - Chronologically sorted price history records.
 * @returns Array of arrays, each containing ticks for one hourly bucket.
 */
function groupIntoHourlyBuckets(ticks: PriceHistoryRecord[]): PriceHistoryRecord[][] {
  const buckets: Map<string, PriceHistoryRecord[]> = new Map();

  for (const tick of ticks) {
    const tickDate = new Date(tick.timestamp);
    const hourStart = new Date(tickDate.getFullYear(), tickDate.getMonth(), tickDate.getDate(), tickDate.getHours());
    const hourKey = hourStart.toISOString();

    let bucket = buckets.get(hourKey);
    if (!bucket) {
      bucket = [];
      buckets.set(hourKey, bucket);
    }
    bucket.push(tick);
  }

  // Return buckets sorted chronologically
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, ticks]) => ticks);
}

/**
 * Step Functions Step 3 — RunBacktest.
 *
 * Fetches 30 days of price history, groups into hourly buckets, and replays
 * the bot's buy/sell rule logic tick-by-tick. Produces a complete backtest
 * report with summary statistics and hourly bucket data.
 *
 * @param event - The Step Functions input from the validate step.
 * @returns The complete backtest report object.
 */
export async function handler(event: EngineInput) {
  const { backtestId, sub, botId, botConfigSnapshot: bot, windowStart, windowEnd } = event;

  // Determine sizing mode
  const hasSizing = bot.buySizing || bot.sellSizing;
  const sizingMode: BacktestSizingMode = hasSizing ? 'configured' : 'default_1000_aud';

  // Fetch all price history ticks for the window
  const ticks = await fetchPriceHistory(bot.pair, windowStart, windowEnd);

  if (ticks.length === 0) {
    throw new Error('No price history data available for the specified window');
  }

  // Group into hourly buckets
  const tickBuckets = groupIntoHourlyBuckets(ticks);

  // Simulation state
  const state: SimulationState = {};
  const allTrades: SimulatedTrade[] = [];
  const hourlyBuckets: HourlyBucket[] = [];
  // FIFO queue of unmatched buys for O(n) P&L pairing across buckets
  const unmatchedBuyQueue: SimulatedTrade[] = [];

  // Process each hourly bucket
  for (const bucketTicks of tickBuckets) {
    const bucketTrades: SimulatedTrade[] = [];
    const hourStart = new Date(bucketTicks[0]!.timestamp);
    const hourKey = new Date(hourStart.getFullYear(), hourStart.getMonth(), hourStart.getDate(), hourStart.getHours()).toISOString();

    // Evaluate each tick — only one action per tick to mirror live engine behaviour
    // (live bot-executor processes one action per SNS event, never both on the same tick)
    for (const tick of bucketTicks) {
      const tickTime = new Date(tick.timestamp).getTime();
      const indicators = tick.indicators;
      let tradeFired = false;

      // Try buy action
      if (!tradeFired && bot.buyQuery) {
        const trade = tryExecute(bot, 'buy', indicators, tickTime, state);
        if (trade) {
          bucketTrades.push(trade);
          allTrades.push(trade);
          unmatchedBuyQueue.push(trade);
          tradeFired = true;
        }
      }

      // Try sell action — skip if a buy already fired on this tick
      if (!tradeFired && (bot.sellQuery || bot.stopLoss || bot.takeProfit)) {
        const trade = tryExecute(bot, 'sell', indicators, tickTime, state);
        if (trade) {
          bucketTrades.push(trade);
          allTrades.push(trade);
        }
      }
    }

    // Aggregate bucket — pair sells with oldest unmatched buys (O(n) FIFO)
    let bucketPnl = 0;
    let bucketBuys = 0;
    let bucketSells = 0;

    for (const trade of bucketTrades) {
      if (trade.action === 'buy') {
        bucketBuys++;
      } else {
        bucketSells++;
        if (unmatchedBuyQueue.length > 0) {
          const matchedBuy = unmatchedBuyQueue.shift()!;
          bucketPnl += calculatePairPnl(matchedBuy.price, trade.price, matchedBuy.sizing, sizingMode);
        }
      }
    }

    hourlyBuckets.push({
      hourStart: hourKey,
      totalTrades: bucketTrades.length,
      totalBuys: bucketBuys,
      totalSells: bucketSells,
      realisedPnl: Math.round(bucketPnl * 100) / 100,
      openPrice: bucketTicks[0]!.price,
      closePrice: bucketTicks[bucketTicks.length - 1]!.price,
    });
  }

  // Compute overall summary
  const totalBuys = allTrades.filter((t) => t.action === 'buy');
  const totalSells = allTrades.filter((t) => t.action === 'sell');

  // Pair buy→sell for P&L and win rate
  const pairs: { buyPrice: number; sellPrice: number; buyTime: string; sellTime: string; sizing?: SizingConfig }[] = [];
  const unmatchedBuys = [...totalBuys];

  for (const sell of totalSells) {
    if (unmatchedBuys.length > 0) {
      const buy = unmatchedBuys.shift()!;
      pairs.push({
        buyPrice: buy.price,
        sellPrice: sell.price,
        buyTime: buy.timestamp,
        sellTime: sell.timestamp,
        sizing: buy.sizing,
      });
    }
  }

  let netPnl = 0;
  let winCount = 0;
  let largestGain = 0;
  let largestLoss = 0;
  let totalHoldTimeMinutes = 0;

  for (const pair of pairs) {
    const pnl = calculatePairPnl(pair.buyPrice, pair.sellPrice, pair.sizing, sizingMode);
    netPnl += pnl;
    if (pnl > 0) winCount++;
    if (pnl > largestGain) largestGain = pnl;
    if (pnl < largestLoss) largestLoss = pnl;

    const holdMs = new Date(pair.sellTime).getTime() - new Date(pair.buyTime).getTime();
    totalHoldTimeMinutes += holdMs / 60_000;
  }

  // Add unrealised P&L for open positions
  if (unmatchedBuys.length > 0 && ticks.length > 0) {
    const finalPrice = ticks[ticks.length - 1]!.price;
    for (const buy of unmatchedBuys) {
      netPnl += calculatePairPnl(buy.price, finalPrice, buy.sizing, sizingMode);
    }
  }

  const winRate = pairs.length > 0 ? Math.round((winCount / pairs.length) * 10000) / 100 : 0;
  const avgHoldTimeMinutes = pairs.length > 0 ? Math.round(totalHoldTimeMinutes / pairs.length) : 0;

  const summary: BacktestSummary = {
    netPnl: Math.round(netPnl * 100) / 100,
    winRate,
    totalTrades: allTrades.length,
    totalBuys: totalBuys.length,
    totalSells: totalSells.length,
    largestGain: Math.round(largestGain * 100) / 100,
    largestLoss: Math.round(largestLoss * 100) / 100,
    avgHoldTimeMinutes,
  };

  const report: BacktestReport = {
    backtestId,
    botId,
    sub,
    windowStart,
    windowEnd,
    sizingMode,
    botConfigSnapshot: bot,
    summary,
    hourlyBuckets,
  };

  return {
    backtestId,
    sub,
    botId,
    windowStart,
    windowEnd,
    report,
  };
}
