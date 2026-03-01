import type { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { BotRecord, TradeRecord, BotPerformanceRecord } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** 90 days in seconds — TTL offset for performance snapshot records. */
const PERF_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Calculates cumulative P&L for a bot based on its trade history
 * and the current market price.
 *
 * Each trade is treated as a 1-unit signal (buy 1 unit / sell 1 unit).
 * P&L tracks signal quality, not actual position sizes.
 *
 * @param trades - All trades for the bot, in chronological order.
 * @param currentPrice - Current market price of the trading pair.
 * @returns Computed P&L metrics.
 */
function calculatePnl(
  trades: TradeRecord[],
  currentPrice: number,
): Pick<BotPerformanceRecord, 'totalBuys' | 'totalSells' | 'totalBuyValue' | 'totalSellValue' | 'realisedPnl' | 'unrealisedPnl' | 'netPnl' | 'netPosition' | 'winRate'> {
  let totalBuys = 0;
  let totalSells = 0;
  let totalBuyValue = 0;
  let totalSellValue = 0;

  for (const trade of trades) {
    if (trade.action === 'buy') {
      totalBuys++;
      totalBuyValue += trade.price;
    } else {
      totalSells++;
      totalSellValue += trade.price;
    }
  }

  const netPosition = totalBuys - totalSells;
  const avgBuyCost = totalBuys > 0 ? totalBuyValue / totalBuys : 0;

  // Realised P&L: profit/loss on units that have been both bought and sold
  // Guard: when there are no buys, avgBuyCost is 0 which would incorrectly
  // treat sell value as pure profit — require at least one buy for realised P&L.
  const realisedPnl = totalSells > 0 && totalBuys > 0 ? totalSellValue - (totalSells * avgBuyCost) : 0;

  // Unrealised P&L: value of open position vs average cost
  const unrealisedPnl = netPosition > 0 ? netPosition * (currentPrice - avgBuyCost) : 0;

  // Win rate: percentage of sells where sell price exceeded average buy cost
  const sellTrades = trades.filter((t) => t.action === 'sell');
  const winningSells = sellTrades.filter((t) => t.price > avgBuyCost).length;
  const winRate = sellTrades.length > 0 ? (winningSells / sellTrades.length) * 100 : 0;

  return {
    totalBuys,
    totalSells,
    totalBuyValue,
    totalSellValue,
    realisedPnl,
    unrealisedPnl,
    netPnl: realisedPnl + unrealisedPnl,
    netPosition,
    winRate,
  };
}

/**
 * Scheduled Lambda that computes and stores P&L snapshots for all active bots.
 *
 * Runs every 5 minutes via EventBridge schedule. For each active bot,
 * queries its trade history, fetches the latest price for its pair,
 * and writes a performance snapshot.
 *
 * @param _event - The EventBridge scheduled event (unused).
 */
export async function handler(_event: ScheduledEvent): Promise<void> {
  // Scan for active bots (filter in DynamoDB to reduce data transfer)
  const activeBots: BotRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const scan = await ddbDoc.send(new ScanCommand({
      TableName: process.env.BOTS_TABLE_NAME!,
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':active': 'active' },
      ExclusiveStartKey: lastKey,
    }));
    activeBots.push(...(scan.Items as BotRecord[] ?? []));
    lastKey = scan.LastEvaluatedKey;
  } while (lastKey);

  if (activeBots.length === 0) {
    console.log('No active bots found — skipping performance recording');
    return;
  }

  console.log(`Computing performance for ${activeBots.length} active bots`);

  const now = new Date();
  const timestamp = now.toISOString();
  const ttl = Math.floor(now.getTime() / 1000) + PERF_TTL_SECONDS;

  // Group bots by pair to avoid duplicate price lookups
  const botsByPair = new Map<string, BotRecord[]>();
  for (const bot of activeBots) {
    const existing = botsByPair.get(bot.pair) ?? [];
    existing.push(bot);
    botsByPair.set(bot.pair, existing);
  }

  // Fetch latest price for each unique pair from price history table
  const priceLookups = [...botsByPair.keys()].map(async (pair) => {
    const result = await ddbDoc.send(new QueryCommand({
      TableName: process.env.PRICE_HISTORY_TABLE_NAME!,
      KeyConditionExpression: '#pair = :pair',
      ExpressionAttributeNames: { '#pair': 'pair' },
      ExpressionAttributeValues: { ':pair': pair },
      ScanIndexForward: false,
      Limit: 1,
    }));
    const price = (result.Items?.[0] as { price?: number } | undefined)?.price ?? 0;
    return [pair, price] as const;
  });

  const priceMap = new Map(await Promise.all(priceLookups));

  // Process each bot: fetch trades, compute P&L, write snapshot
  const writes = activeBots.map(async (bot) => {
    try {
      // Fetch all trades for this bot (sorted ascending by timestamp)
      const trades: TradeRecord[] = [];
      let tradeLastKey: Record<string, unknown> | undefined;
      do {
        const tradeResult = await ddbDoc.send(new QueryCommand({
          TableName: process.env.TRADES_TABLE_NAME!,
          KeyConditionExpression: 'botId = :botId',
          ExpressionAttributeValues: { ':botId': bot.botId },
          ScanIndexForward: true,
          ExclusiveStartKey: tradeLastKey,
        }));
        trades.push(...(tradeResult.Items as TradeRecord[] ?? []));
        tradeLastKey = tradeResult.LastEvaluatedKey;
      } while (tradeLastKey);

      const currentPrice = priceMap.get(bot.pair) ?? 0;
      const pnl = calculatePnl(trades, currentPrice);

      const record: BotPerformanceRecord = {
        botId: bot.botId,
        timestamp,
        sub: bot.sub,
        pair: bot.pair,
        currentPrice,
        ...pnl,
        exchangeId: bot.exchangeId ?? 'demo',
        ttl,
      };

      await ddbDoc.send(new PutCommand({
        TableName: process.env.BOT_PERFORMANCE_TABLE_NAME!,
        Item: record,
      }));
    } catch (err) {
      // Log and continue — don't let one bot failure stop the rest
      console.error(`Failed to record performance for bot ${bot.botId}:`, err);
    }
  });

  await Promise.all(writes);
  console.log(`Recorded performance snapshots for ${activeBots.length} bots`);
}
