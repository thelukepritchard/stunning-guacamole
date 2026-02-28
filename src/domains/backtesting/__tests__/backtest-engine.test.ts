// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockSend }) },
  QueryCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Query' })),
}));

import type { BotRecord, PriceHistoryRecord, IndicatorSnapshot, RuleGroup } from '../../shared/types';
import { handler } from '../async/backtest-engine';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A rule group that always evaluates to true. */
const ALWAYS_TRUE_QUERY: RuleGroup = {
  combinator: 'and',
  rules: [{ field: 'price', operator: '>', value: '0' }],
};

/** A rule group that always evaluates to false. */
const ALWAYS_FALSE_QUERY: RuleGroup = {
  combinator: 'and',
  rules: [{ field: 'price', operator: '>', value: '999999999' }],
};

/**
 * Builds a minimal BotRecord for testing.
 */
function buildBot(overrides: Partial<BotRecord> = {}): BotRecord {
  return {
    sub: 'user-1',
    botId: 'bot-1',
    name: 'Test Bot',
    pair: 'BTC',
    status: 'active',
    executionMode: 'once_and_wait',
    buyQuery: ALWAYS_TRUE_QUERY,
    sellQuery: ALWAYS_TRUE_QUERY,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Builds a minimal IndicatorSnapshot.
 */
function buildIndicators(price = 50_000): IndicatorSnapshot {
  return {
    price,
    volume_24h: 1_000_000,
    price_change_pct: 0.5,
    rsi_14: 55,
    rsi_7: 53,
    macd_histogram: 0.1,
    macd_signal: 'above_signal',
    sma_20: 49_000,
    sma_50: 48_000,
    sma_200: 45_000,
    ema_12: 50_100,
    ema_20: 49_500,
    ema_26: 49_000,
    bb_upper: 52_000,
    bb_lower: 48_000,
    bb_position: 'between_bands',
  };
}

/**
 * Builds a price history record for a given minute offset from a base time.
 */
function buildTick(baseTime: Date, minuteOffset: number, price: number): PriceHistoryRecord {
  const tickTime = new Date(baseTime.getTime() + minuteOffset * 60_000);
  return {
    pair: 'BTC',
    timestamp: tickTime.toISOString(),
    price,
    volume_24h: 1_000_000,
    price_change_pct: 0.5,
    indicators: buildIndicators(price),
    ttl: Math.floor(tickTime.getTime() / 1000) + 30 * 24 * 60 * 60,
  };
}

/** Standard engine input builder. */
function buildEngineInput(bot: BotRecord = buildBot()) {
  return {
    backtestId: 'bt-1',
    sub: 'user-1',
    botId: 'bot-1',
    botConfigSnapshot: bot,
    windowStart: '2024-01-01T00:00:00Z',
    windowEnd: '2024-01-31T00:00:00Z',
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('backtest-engine handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    QueryCommand.mockImplementation((params: object) => ({ ...params, _type: 'Query' }));

    process.env.PRICE_HISTORY_TABLE_NAME = 'price-history-table';
  });

  // ── no price data ────────────────────────────────────────────────────────────

  /**
   * Should throw when no price history data is available.
   */
  it('should throw when no price history is available', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await expect(handler(buildEngineInput())).rejects.toThrow(
      'No price history data available',
    );
  });

  // ── once_and_wait mode — buy/sell alternation ────────────────────────────────

  /**
   * In once_and_wait mode, the first trade should be a buy, and the second
   * should be a sell (alternating).
   */
  it('should alternate buy and sell in once_and_wait mode', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    const ticks = [
      buildTick(baseTime, 0, 50_000),
      buildTick(baseTime, 1, 51_000),
      buildTick(baseTime, 2, 52_000),
    ];

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot({ executionMode: 'once_and_wait' });
    const result = await handler(buildEngineInput(bot));

    // tick0=buy, tick1=sell (counter-action), tick2=buy (counter-action)
    expect(result.report.summary.totalBuys).toBe(2);
    expect(result.report.summary.totalSells).toBe(1);
    expect(result.report.summary.totalTrades).toBe(3);
  });

  /**
   * With no sellQuery, only buy trades should fire.
   */
  it('should only fire buys when sellQuery is undefined', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    const ticks = [
      buildTick(baseTime, 0, 50_000),
      buildTick(baseTime, 1, 51_000),
      buildTick(baseTime, 2, 52_000),
    ];

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot({ sellQuery: undefined });
    const result = await handler(buildEngineInput(bot));

    // once_and_wait: buy fires on tick 0, then no sell is possible
    expect(result.report.summary.totalBuys).toBe(1);
    expect(result.report.summary.totalSells).toBe(0);
  });

  // ── condition_cooldown mode ──────────────────────────────────────────────────

  /**
   * In condition_cooldown mode with cooldownMinutes, trades should respect
   * the cooldown period.
   */
  it('should respect cooldown in condition_cooldown mode', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    // 10 ticks, 1 minute apart
    const ticks = Array.from({ length: 10 }, (_, i) => buildTick(baseTime, i, 50_000));

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot({
      executionMode: 'condition_cooldown',
      cooldownMinutes: 5, // 5-minute cooldown
    });
    const result = await handler(buildEngineInput(bot));

    // With a 5-minute cooldown and 10 ticks (1/minute):
    // Buy at tick 0, next buy allowed at tick 5, sell at tick 0 (no cooldown yet), next sell at tick 5
    // Total should be limited by cooldowns
    expect(result.report.summary.totalTrades).toBeLessThan(10);
  });

  // ── stop-loss trigger ────────────────────────────────────────────────────────

  /**
   * Stop-loss should trigger a sell when price drops below the threshold.
   */
  it('should trigger stop-loss sell when price drops below threshold', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    const ticks = [
      buildTick(baseTime, 0, 50_000),  // buy fires
      buildTick(baseTime, 1, 45_000),  // 10% drop → should trigger SL
    ];

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot({
      sellQuery: ALWAYS_FALSE_QUERY, // sell query won't match — only SL should fire
      stopLoss: { percentage: 10 },  // 10% stop loss
    });
    const result = await handler(buildEngineInput(bot));

    expect(result.report.summary.totalBuys).toBe(1);
    expect(result.report.summary.totalSells).toBe(1);
  });

  // ── take-profit trigger ──────────────────────────────────────────────────────

  /**
   * Take-profit should trigger a sell when price rises above the threshold.
   */
  it('should trigger take-profit sell when price rises above threshold', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    const ticks = [
      buildTick(baseTime, 0, 50_000),  // buy fires
      buildTick(baseTime, 1, 56_000),  // 12% rise → should trigger TP
    ];

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot({
      sellQuery: ALWAYS_FALSE_QUERY, // sell query won't match — only TP should fire
      takeProfit: { percentage: 10 },  // 10% take profit
    });
    const result = await handler(buildEngineInput(bot));

    expect(result.report.summary.totalBuys).toBe(1);
    expect(result.report.summary.totalSells).toBe(1);
  });

  // ── P&L calculation ─────────────────────────────────────────────────────────

  /**
   * Net P&L should reflect profitable buy→sell cycles.
   */
  it('should calculate positive P&L for profitable trades', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    const ticks = [
      buildTick(baseTime, 0, 40_000),  // buy at 40k
      buildTick(baseTime, 1, 50_000),  // sell at 50k → profit
    ];

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot(); // default $1000 sizing
    const result = await handler(buildEngineInput(bot));

    // default_1000_aud: qty = 1000/40000 = 0.025, P&L = 0.025 * (50000-40000) = 250
    expect(result.report.summary.netPnl).toBeCloseTo(250, 0);
    expect(result.report.summary.winRate).toBe(100);
  });

  /**
   * Net P&L should reflect loss-making buy→sell cycles.
   */
  it('should calculate negative P&L for loss-making trades', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    const ticks = [
      buildTick(baseTime, 0, 50_000),  // buy at 50k
      buildTick(baseTime, 1, 40_000),  // sell at 40k → loss
    ];

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot();
    const result = await handler(buildEngineInput(bot));

    // qty = 1000/50000 = 0.02, P&L = 0.02 * (40000-50000) = -200
    expect(result.report.summary.netPnl).toBeCloseTo(-200, 0);
    expect(result.report.summary.winRate).toBe(0);
  });

  // ── configured sizing (fixed) ───────────────────────────────────────────────

  /**
   * With fixed buySizing, P&L should use the configured value.
   */
  it('should use configured fixed sizing for P&L calculation', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    const ticks = [
      buildTick(baseTime, 0, 50_000),  // buy at 50k
      buildTick(baseTime, 1, 60_000),  // sell at 60k
    ];

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot({
      buySizing: { type: 'fixed', value: 500 }, // $500 fixed
    });
    const result = await handler(buildEngineInput(bot));

    // configured mode: qty = 500/50000 = 0.01, P&L = 0.01 * (60000-50000) = 100
    expect(result.report.summary.netPnl).toBeCloseTo(100, 0);
    expect(result.report.sizingMode).toBe('configured');
  });

  // ── hourly bucket aggregation ───────────────────────────────────────────────

  /**
   * Trades within the same hour should be aggregated into one bucket.
   */
  it('should group trades into hourly buckets', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    // 3 ticks in the first hour, 2 ticks in the second hour
    const ticks = [
      buildTick(baseTime, 0, 50_000),
      buildTick(baseTime, 30, 51_000),
      buildTick(baseTime, 59, 52_000),
      buildTick(baseTime, 60, 53_000),  // second hour
      buildTick(baseTime, 90, 54_000),
    ];

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot();
    const result = await handler(buildEngineInput(bot));

    expect(result.report.hourlyBuckets.length).toBe(2);
    expect(result.report.hourlyBuckets[0]!.openPrice).toBe(50_000);
    expect(result.report.hourlyBuckets[0]!.closePrice).toBe(52_000);
    expect(result.report.hourlyBuckets[1]!.openPrice).toBe(53_000);
    expect(result.report.hourlyBuckets[1]!.closePrice).toBe(54_000);
  });

  // ── summary statistics ──────────────────────────────────────────────────────

  /**
   * Summary should contain correct trade counts.
   */
  it('should include correct summary statistics', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    const ticks = [
      buildTick(baseTime, 0, 50_000),
      buildTick(baseTime, 1, 55_000),
    ];

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot();
    const result = await handler(buildEngineInput(bot));

    expect(result.report.summary.totalBuys).toBeGreaterThanOrEqual(1);
    expect(result.report.summary.totalSells).toBeGreaterThanOrEqual(0);
    expect(result.report.summary.totalTrades).toBe(
      result.report.summary.totalBuys + result.report.summary.totalSells,
    );
    expect(typeof result.report.summary.avgHoldTimeMinutes).toBe('number');
    expect(typeof result.report.summary.largestGain).toBe('number');
    expect(typeof result.report.summary.largestLoss).toBe('number');
  });

  // ── report structure ─────────────────────────────────────────────────────────

  /**
   * The returned report should contain all required fields.
   */
  it('should return a complete report structure', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    const ticks = [buildTick(baseTime, 0, 50_000)];

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot();
    const result = await handler(buildEngineInput(bot));

    expect(result.backtestId).toBe('bt-1');
    expect(result.sub).toBe('user-1');
    expect(result.botId).toBe('bot-1');
    expect(result.report.backtestId).toBe('bt-1');
    expect(result.report.botId).toBe('bot-1');
    expect(result.report.sub).toBe('user-1');
    expect(result.report.windowStart).toBe('2024-01-01T00:00:00Z');
    expect(result.report.windowEnd).toBe('2024-01-31T00:00:00Z');
    expect(result.report.botConfigSnapshot).toEqual(bot);
    expect(Array.isArray(result.report.hourlyBuckets)).toBe(true);
  });

  // ── pagination of price history ──────────────────────────────────────────────

  /**
   * Should follow pagination when fetching price history.
   */
  it('should paginate price history fetches', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    const page1Ticks = [buildTick(baseTime, 0, 50_000)];
    const page2Ticks = [buildTick(baseTime, 1, 51_000)];

    mockSend
      .mockResolvedValueOnce({ Items: page1Ticks, LastEvaluatedKey: { pair: 'BTC', timestamp: page1Ticks[0]!.timestamp } })
      .mockResolvedValueOnce({ Items: page2Ticks, LastEvaluatedKey: undefined });

    const result = await handler(buildEngineInput());

    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    expect(QueryCommand).toHaveBeenCalledTimes(2);
    expect(result.report.summary.totalTrades).toBeGreaterThanOrEqual(1);
  });

  // ── unrealised P&L for open positions ────────────────────────────────────────

  /**
   * When there are unmatched buys at the end, unrealised P&L should be
   * included in the net P&L.
   */
  it('should include unrealised P&L for unmatched buys', async () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    // Only one tick → buy fires but no sell opportunity
    const ticks = [buildTick(baseTime, 0, 50_000)];

    mockSend.mockResolvedValueOnce({ Items: ticks, LastEvaluatedKey: undefined });

    const bot = buildBot({ sellQuery: undefined }); // no sell possible
    const result = await handler(buildEngineInput(bot));

    expect(result.report.summary.totalBuys).toBe(1);
    expect(result.report.summary.totalSells).toBe(0);
    // Net P&L includes unrealised — buy at 50k, final price 50k → 0 unrealised
    expect(result.report.summary.netPnl).toBe(0);
  });
});
