import type { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { PortfolioRecord, PortfolioPerformanceRecord } from '../../shared/types';
import type { BotPerformanceRecord } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** 90 days in seconds — TTL offset for portfolio performance snapshot records. */
const PERF_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Aggregates the latest bot performance snapshots for a single user
 * into portfolio-level P&L metrics.
 *
 * Queries the bot-performance table's `sub-index` GSI for recent
 * snapshots (last 10 minutes to ensure at least one per bot),
 * deduplicates by botId, and sums the P&L values.
 *
 * @param sub - The user's Cognito sub.
 * @returns Aggregated P&L metrics and active bot count.
 */
async function aggregateBotPerformance(sub: string): Promise<{
  activeBots: number;
  totalNetPnl: number;
  totalRealisedPnl: number;
  totalUnrealisedPnl: number;
}> {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.BOT_PERFORMANCE_TABLE_NAME!,
    IndexName: 'sub-index',
    KeyConditionExpression: '#sub = :sub AND #ts >= :since',
    ExpressionAttributeNames: { '#sub': 'sub', '#ts': 'timestamp' },
    ExpressionAttributeValues: { ':sub': sub, ':since': since },
    ScanIndexForward: false,
  }));

  // Deduplicate by botId — take the latest snapshot per bot
  const latestByBot = new Map<string, BotPerformanceRecord>();
  for (const item of result.Items ?? []) {
    const record = item as BotPerformanceRecord;
    if (!latestByBot.has(record.botId)) {
      latestByBot.set(record.botId, record);
    }
  }

  let totalNetPnl = 0;
  let totalRealisedPnl = 0;
  let totalUnrealisedPnl = 0;

  for (const perf of latestByBot.values()) {
    totalNetPnl += perf.netPnl;
    totalRealisedPnl += perf.realisedPnl;
    totalUnrealisedPnl += perf.unrealisedPnl;
  }

  return {
    activeBots: latestByBot.size,
    totalNetPnl,
    totalRealisedPnl,
    totalUnrealisedPnl,
  };
}

/**
 * Calculates the 24-hour P&L change for a user by comparing their
 * current net P&L to the oldest portfolio snapshot within the last 24 hours.
 *
 * @param sub - The user's Cognito sub.
 * @param currentNetPnl - The user's current aggregate net P&L.
 * @returns The change in net P&L over the last 24 hours.
 */
async function calculatePnl24h(sub: string, currentNetPnl: number): Promise<number> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.PORTFOLIO_PERFORMANCE_TABLE_NAME!,
    KeyConditionExpression: '#sub = :sub AND #ts >= :since',
    ExpressionAttributeNames: { '#sub': 'sub', '#ts': 'timestamp' },
    ExpressionAttributeValues: { ':sub': sub, ':since': since24h },
    ScanIndexForward: true,
    Limit: 1,
  }));

  const snapshot24hAgo = result.Items?.[0] as PortfolioPerformanceRecord | undefined;
  return snapshot24hAgo ? currentNetPnl - snapshot24hAgo.totalNetPnl : currentNetPnl;
}

/**
 * Scheduled Lambda that computes and stores portfolio-level P&L snapshots
 * for all registered users.
 *
 * Runs every 5 minutes via EventBridge schedule. For each user in the
 * portfolio table, aggregates their bots' latest performance data from
 * the trading domain's bot-performance table, calculates 24h P&L change,
 * and writes a portfolio performance snapshot.
 *
 * @param _event - The EventBridge scheduled event (unused).
 */
export async function handler(_event: ScheduledEvent): Promise<void> {
  // Scan portfolio table to get all registered users
  const users: PortfolioRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const scan = await ddbDoc.send(new ScanCommand({
      TableName: process.env.PORTFOLIO_TABLE_NAME!,
      ProjectionExpression: '#sub',
      ExpressionAttributeNames: { '#sub': 'sub' },
      ExclusiveStartKey: lastKey,
    }));
    users.push(...(scan.Items as PortfolioRecord[] ?? []));
    lastKey = scan.LastEvaluatedKey;
  } while (lastKey);

  if (users.length === 0) {
    console.log('No registered users found — skipping portfolio performance recording');
    return;
  }

  console.log(`Computing portfolio performance for ${users.length} users`);

  const now = new Date();
  const timestamp = now.toISOString();
  const ttl = Math.floor(now.getTime() / 1000) + PERF_TTL_SECONDS;

  const writes = users.map(async (user) => {
    try {
      const metrics = await aggregateBotPerformance(user.sub);
      const pnl24h = await calculatePnl24h(user.sub, metrics.totalNetPnl);

      const record: PortfolioPerformanceRecord = {
        sub: user.sub,
        timestamp,
        ...metrics,
        pnl24h,
        ttl,
      };

      await ddbDoc.send(new PutCommand({
        TableName: process.env.PORTFOLIO_PERFORMANCE_TABLE_NAME!,
        Item: record,
      }));
    } catch (err) {
      console.error(`Failed to record portfolio performance for user ${user.sub}:`, err);
    }
  });

  await Promise.all(writes);
  console.log(`Recorded portfolio performance snapshots for ${users.length} users`);
}
