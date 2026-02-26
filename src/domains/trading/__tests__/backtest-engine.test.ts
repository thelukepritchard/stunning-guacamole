const mockDdbSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDdbSend })) },
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
}));

import { handler } from '../async/backtest-engine';
import type { BotRecord, PriceHistoryRecord, IndicatorSnapshot } from '../types';

/** Baseline indicator snapshot used across tests. */
const baseIndicators: IndicatorSnapshot = {
  price: 50000,
  volume_24h: 15000,
  price_change_pct: 2.5,
  rsi_14: 65,
  rsi_7: 70,
  macd_histogram: 150,
  macd_signal: 'above_signal',
  sma_20: 49500,
  sma_50: 48000,
  sma_200: 45000,
  ema_12: 49800,
  ema_20: 49600,
  ema_26: 49400,
  bb_upper: 51000,
  bb_lower: 48000,
  bb_position: 'between_bands',
};

/**
 * Builds a mock price history tick.
 *
 * @param pair - The trading pair.
 * @param timestamp - ISO timestamp for the tick.
 * @param priceOverride - Optional price override (defaults to 50000).
 * @returns A PriceHistoryRecord.
 */
function buildTick(pair: string, timestamp: string, priceOverride = 50000): PriceHistoryRecord {
  return {
    pair,
    timestamp,
    price: priceOverride,
    volume_24h: 15000,
    price_change_pct: 2.5,
    indicators: { ...baseIndicators, price: priceOverride },
    ttl: Math.floor(Date.now() / 1000) + 86400,
  };
}

/**
 * Builds a minimal bot record for backtest engine tests.
 *
 * @param overrides - Fields to override on the default bot.
 * @returns A BotRecord.
 */
function buildBot(overrides: Partial<BotRecord> = {}): BotRecord {
  return {
    sub: 'user-123',
    botId: 'bot-001',
    name: 'Test Bot',
    pair: 'BTC/USDT',
    status: 'active',
    executionMode: 'condition_cooldown',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Standard engine step input. */
const baseEngineInput = {
  backtestId: 'bt-001',
  sub: 'user-123',
  botId: 'bot-001',
  windowStart: '2026-01-01T00:00:00.000Z',
  windowEnd: '2026-01-01T02:00:00.000Z',
};

/**
 * Tests for the backtest engine Step Functions handler.
 * Covers hourly bucketing, P&L calculation, rule evaluation simulation,
 * sizing modes, stop-loss/take-profit, and pagination.
 */
describe('backtest-engine handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PRICE_HISTORY_TABLE_NAME = 'PriceHistoryTable';
  });

  /** Verifies the handler throws when no price history data is found. */
  it('throws when no price history data is available for the window', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] }); // empty price history

    await expect(
      handler({ ...baseEngineInput, botConfigSnapshot: buildBot() }),
    ).rejects.toThrow('No price history data available for the specified window');
  });

  /** Verifies the report structure is correct for a bot with no trades firing. */
  it('returns a report with zero trades when no rules match', async () => {
    // buyQuery requires price > 100000 — will never match 50000 price
    const bot = buildBot({
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '100000' }] },
    });

    const ticks = [
      buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z'),
      buildTick('BTC/USDT', '2026-01-01T00:01:00.000Z'),
    ];

    mockDdbSend.mockResolvedValueOnce({ Items: ticks });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.summary.totalTrades).toBe(0);
    expect(result.report.summary.totalBuys).toBe(0);
    expect(result.report.summary.totalSells).toBe(0);
    expect(result.report.summary.netPnl).toBe(0);
    expect(result.report.summary.winRate).toBe(0);
  });

  /** Verifies a buy fires and is recorded when the buyQuery matches. */
  it('records a buy trade when buyQuery matches', async () => {
    // buyQuery requires price > 40000 — will match 50000
    const bot = buildBot({
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    });

    const ticks = [
      buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 50000),
    ];

    mockDdbSend.mockResolvedValueOnce({ Items: ticks });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.summary.totalBuys).toBe(1);
    expect(result.report.summary.totalSells).toBe(0);
    expect(result.report.summary.totalTrades).toBe(1);
  });

  /** Verifies a complete buy→sell cycle calculates net P&L correctly. */
  it('calculates positive P&L for a profitable buy-sell cycle with default sizing', async () => {
    // buyQuery matches when price < 50000, sellQuery matches when price > 49000
    const bot = buildBot({
      executionMode: 'condition_cooldown',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '<', value: '50000' }] },
      sellQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '49000' }] },
    });

    // Tick 1: buy at 45000 (45000 < 50000 → buy matches; 45000 < 49000 → sell doesn't match)
    const tick1 = buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 45000);
    tick1.indicators = { ...baseIndicators, price: 45000 };

    // Tick 2: sell at 55000 (55000 > 50000 → buy doesn't match; 55000 > 49000 → sell matches)
    const tick2 = buildTick('BTC/USDT', '2026-01-01T00:01:00.000Z', 55000);
    tick2.indicators = { ...baseIndicators, price: 55000 };

    mockDdbSend.mockResolvedValueOnce({ Items: [tick1, tick2] });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.summary.totalBuys).toBe(1);
    expect(result.report.summary.totalSells).toBe(1);
    expect(result.report.summary.totalTrades).toBe(2);

    // Default sizing: $1000 AUD / 45000 = 0.02222 BTC, sold at 55000
    // P&L = 0.02222 * (55000 - 45000) = 222.22 (approx)
    expect(result.report.summary.netPnl).toBeGreaterThan(0);
    expect(result.report.summary.winRate).toBe(100);
  });

  /** Verifies fixed sizing is used when configured on the bot. */
  it('uses configured fixed sizing for P&L calculation instead of default 1000 AUD', async () => {
    const bot = buildBot({
      executionMode: 'condition_cooldown',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '<', value: '50000' }] },
      sellQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '49000' }] },
      buySizing: { type: 'fixed', value: 500 }, // $500 fixed
    });

    const tick1 = buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 40000);
    tick1.indicators = { ...baseIndicators, price: 40000 };

    const tick2 = buildTick('BTC/USDT', '2026-01-01T00:01:00.000Z', 50000);
    tick2.indicators = { ...baseIndicators, price: 50000 };

    mockDdbSend.mockResolvedValueOnce({ Items: [tick1, tick2] });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.sizingMode).toBe('configured');
    // Fixed $500 / 40000 = 0.0125 BTC, sold at 50000 → P&L = 0.0125 * 10000 = 125
    expect(result.report.summary.netPnl).toBeCloseTo(125, 1);
  });

  /** Verifies sizingMode is 'default_1000_aud' when no sizing is configured. */
  it('uses default_1000_aud sizing mode when bot has no buySizing or sellSizing', async () => {
    const bot = buildBot({
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    });

    const ticks = [buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 50000)];
    mockDdbSend.mockResolvedValueOnce({ Items: ticks });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.sizingMode).toBe('default_1000_aud');
  });

  /** Verifies ticks are grouped correctly into hourly buckets. */
  it('groups ticks into hourly buckets and produces one bucket per hour', async () => {
    const bot = buildBot({
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    });

    const ticks = [
      buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 50000), // hour 0
      buildTick('BTC/USDT', '2026-01-01T00:30:00.000Z', 50500), // hour 0
      buildTick('BTC/USDT', '2026-01-01T01:00:00.000Z', 51000), // hour 1
      buildTick('BTC/USDT', '2026-01-01T01:45:00.000Z', 51500), // hour 1
    ];

    mockDdbSend.mockResolvedValueOnce({ Items: ticks });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.hourlyBuckets).toHaveLength(2);
  });

  /** Verifies hourly bucket fields are correctly populated. */
  it('correctly populates openPrice and closePrice for each hourly bucket', async () => {
    const bot = buildBot({
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    });

    const ticks = [
      buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 49000), // open
      buildTick('BTC/USDT', '2026-01-01T00:30:00.000Z', 50000),
      buildTick('BTC/USDT', '2026-01-01T00:59:00.000Z', 51000), // close
    ];

    mockDdbSend.mockResolvedValueOnce({ Items: ticks });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    const bucket = result.report.hourlyBuckets[0]!;
    expect(bucket.openPrice).toBe(49000);
    expect(bucket.closePrice).toBe(51000);
  });

  /** Verifies stop-loss fires a sell at the correct trigger in once_and_wait mode. */
  it('fires a stop-loss sell in once_and_wait mode when price drops below threshold', async () => {
    const bot = buildBot({
      executionMode: 'once_and_wait',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '<', value: '50000' }] },
      sellQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '99999' }] }, // never matches
      stopLoss: { percentage: 10 }, // 10% below entry
    });

    // Tick 1: buy at 40000 (40000 < 50000 → buy)
    const tick1 = buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 40000);
    tick1.indicators = { ...baseIndicators, price: 40000 };

    // Tick 2: price 35000 — 10% below 40000 is 36000, 35000 < 36000 → stop_loss triggers
    const tick2 = buildTick('BTC/USDT', '2026-01-01T00:01:00.000Z', 35000);
    tick2.indicators = { ...baseIndicators, price: 35000 };

    mockDdbSend.mockResolvedValueOnce({ Items: [tick1, tick2] });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.summary.totalBuys).toBe(1);
    expect(result.report.summary.totalSells).toBe(1);
    // Loss: 1000 / 40000 * (35000 - 40000) = -125
    expect(result.report.summary.netPnl).toBeLessThan(0);
    expect(result.report.summary.largestLoss).toBeLessThan(0);
  });

  /** Verifies take-profit fires a sell when price rises above threshold in once_and_wait mode. */
  it('fires a take-profit sell when price rises above threshold in once_and_wait mode', async () => {
    const bot = buildBot({
      executionMode: 'once_and_wait',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '<', value: '50000' }] },
      sellQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '99999' }] }, // never matches
      takeProfit: { percentage: 20 }, // 20% above entry
    });

    // Buy at 40000
    const tick1 = buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 40000);
    tick1.indicators = { ...baseIndicators, price: 40000 };

    // Price 50000 — 20% above 40000 is 48000, 50000 > 48000 → take_profit
    const tick2 = buildTick('BTC/USDT', '2026-01-01T00:01:00.000Z', 50000);
    tick2.indicators = { ...baseIndicators, price: 50000 };

    mockDdbSend.mockResolvedValueOnce({ Items: [tick1, tick2] });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.summary.totalSells).toBe(1);
    expect(result.report.summary.netPnl).toBeGreaterThan(0);
    expect(result.report.summary.largestGain).toBeGreaterThan(0);
  });

  /** Verifies once_and_wait mode blocks consecutive buys without an intervening sell. */
  it('blocks consecutive buys in once_and_wait mode', async () => {
    const bot = buildBot({
      executionMode: 'once_and_wait',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
      sellQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '99999' }] }, // never matches
    });

    // Both ticks have price > 40000 → buyQuery matches, but only one buy should fire
    const ticks = [
      buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 50000),
      buildTick('BTC/USDT', '2026-01-01T00:01:00.000Z', 51000),
      buildTick('BTC/USDT', '2026-01-01T00:02:00.000Z', 52000),
    ];

    mockDdbSend.mockResolvedValueOnce({ Items: ticks });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.summary.totalBuys).toBe(1);
  });

  /** Verifies condition_cooldown mode respects cooldown between trades. */
  it('respects cooldown between buys in condition_cooldown mode', async () => {
    const bot = buildBot({
      executionMode: 'condition_cooldown',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
      cooldownMinutes: 60, // 60 min cooldown
    });

    // All 3 ticks within 5 minutes of each other — only first buy should fire
    const ticks = [
      buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 50000),
      buildTick('BTC/USDT', '2026-01-01T00:01:00.000Z', 50000),
      buildTick('BTC/USDT', '2026-01-01T00:02:00.000Z', 50000),
    ];

    mockDdbSend.mockResolvedValueOnce({ Items: ticks });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.summary.totalBuys).toBe(1);
  });

  /** Verifies pagination is handled when DynamoDB returns LastEvaluatedKey. */
  it('handles DynamoDB pagination to fetch all price history ticks', async () => {
    const bot = buildBot({
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    });

    const page1Ticks = [
      buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 50000),
      buildTick('BTC/USDT', '2026-01-01T00:01:00.000Z', 50000),
    ];
    const page2Ticks = [
      buildTick('BTC/USDT', '2026-01-01T01:00:00.000Z', 50000),
    ];

    // Page 1 returns LastEvaluatedKey; page 2 does not
    mockDdbSend.mockResolvedValueOnce({
      Items: page1Ticks,
      LastEvaluatedKey: { pair: 'BTC/USDT', timestamp: '2026-01-01T00:01:00.000Z' },
    });
    mockDdbSend.mockResolvedValueOnce({
      Items: page2Ticks,
    });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    // All 3 ticks processed across 2 pages — trades should reflect all ticks
    expect(result.report.summary.totalBuys).toBe(3);
    expect(mockDdbSend).toHaveBeenCalledTimes(2);
  });

  /** Verifies unrealised P&L is added for unmatched buy positions at the end. */
  it('adds unrealised P&L for open positions using final price', async () => {
    const bot = buildBot({
      executionMode: 'condition_cooldown',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '<', value: '50000' }] },
      // No sellQuery — buy fires but no sell — creates unrealised position
    });

    // Buy at 40000, final price is 50000 → unrealised gain
    const tick1 = buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 40000);
    tick1.indicators = { ...baseIndicators, price: 40000 };

    const tick2 = buildTick('BTC/USDT', '2026-01-01T00:01:00.000Z', 50000);
    tick2.indicators = { ...baseIndicators, price: 50000 };

    mockDdbSend.mockResolvedValueOnce({ Items: [tick1, tick2] });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    // Buy fires at tick1, tick2 price is higher → unrealised gain included in netPnl
    expect(result.report.summary.totalBuys).toBe(1);
    expect(result.report.summary.totalSells).toBe(0);
    expect(result.report.summary.netPnl).toBeGreaterThan(0);
  });

  /** Verifies the report contains the correct top-level fields. */
  it('returns a report with all required top-level fields', async () => {
    const bot = buildBot({
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    });

    const ticks = [buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 50000)];
    mockDdbSend.mockResolvedValueOnce({ Items: ticks });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.backtestId).toBe('bt-001');
    expect(result.sub).toBe('user-123');
    expect(result.botId).toBe('bot-001');
    expect(result.windowStart).toBe(baseEngineInput.windowStart);
    expect(result.windowEnd).toBe(baseEngineInput.windowEnd);
    expect(result.report).toBeDefined();
    expect(result.report.summary).toBeDefined();
    expect(result.report.hourlyBuckets).toBeDefined();
  });

  /** Verifies avgHoldTimeMinutes is calculated from completed buy-sell pairs. */
  it('calculates avgHoldTimeMinutes from completed buy-sell pairs', async () => {
    const bot = buildBot({
      executionMode: 'condition_cooldown',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '<', value: '50000' }] },
      sellQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '49000' }] },
    });

    // Buy at T+0, sell at T+60min (60 minutes hold time)
    const tick1 = buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 40000);
    tick1.indicators = { ...baseIndicators, price: 40000 };

    const tick2 = buildTick('BTC/USDT', '2026-01-01T01:00:00.000Z', 55000);
    tick2.indicators = { ...baseIndicators, price: 55000 };

    mockDdbSend.mockResolvedValueOnce({ Items: [tick1, tick2] });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.summary.avgHoldTimeMinutes).toBe(60);
  });

  /** Verifies win rate is 0% when all trades are losers. */
  it('calculates 0% win rate when all trades are losing', async () => {
    const bot = buildBot({
      executionMode: 'condition_cooldown',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '49000' }] },
      sellQuery: { combinator: 'and', rules: [{ field: 'price', operator: '<', value: '51000' }] },
    });

    // Buy at 50000, sell at 45000 (loss)
    const tick1 = buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 50000);
    tick1.indicators = { ...baseIndicators, price: 50000 };

    const tick2 = buildTick('BTC/USDT', '2026-01-01T00:01:00.000Z', 45000);
    tick2.indicators = { ...baseIndicators, price: 45000 };

    mockDdbSend.mockResolvedValueOnce({ Items: [tick1, tick2] });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.summary.winRate).toBe(0);
    expect(result.report.summary.netPnl).toBeLessThan(0);
  });

  /** Verifies winRate is 0 when no buy-sell pairs are completed. */
  it('returns 0% win rate when no buy-sell pairs are completed', async () => {
    const bot = buildBot({
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
      // No sellQuery configured
    });

    const ticks = [buildTick('BTC/USDT', '2026-01-01T00:00:00.000Z', 50000)];
    mockDdbSend.mockResolvedValueOnce({ Items: ticks });

    const result = await handler({ ...baseEngineInput, botConfigSnapshot: bot });

    expect(result.report.summary.winRate).toBe(0);
    expect(result.report.summary.avgHoldTimeMinutes).toBe(0);
  });
});
