// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockSend }) },
  ScanCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Scan' })),
  QueryCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Query' })),
  PutCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Put' })),
}));

import type { ScheduledEvent } from 'aws-lambda';
import type { BotRecord, TradeRecord } from '../../shared/types';
import { handler } from '../async/bot-performance-recorder';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal scheduled event stub. */
const SCHEDULED_EVENT: ScheduledEvent = {
  version: '0',
  id: 'test-event-id',
  'detail-type': 'Scheduled Event',
  source: 'aws.events',
  account: '123456789012',
  time: '2024-01-01T00:00:00Z',
  region: 'ap-southeast-2',
  resources: ['arn:aws:events:ap-southeast-2:123456789012:rule/test'],
  detail: {},
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
    exchangeId: 'demo',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Builds a minimal TradeRecord for testing.
 */
function buildTrade(action: 'buy' | 'sell', price: number, botId = 'bot-1'): TradeRecord {
  return {
    botId,
    timestamp: '2024-01-01T00:05:00.000Z',
    sub: 'user-1',
    pair: 'BTC',
    action,
    price,
    trigger: 'rule',
    exchangeId: 'demo',
    indicators: {
      price,
      volume_24h: 1_000_000,
      price_change_pct: 0.5,
      rsi_14: 55,
      rsi_7: 53,
      macd_histogram: 0.1,
      macd_signal: 'bullish',
      sma_20: 49_000,
      sma_50: 48_000,
      sma_200: 45_000,
      ema_12: 50_100,
      ema_20: 49_500,
      ema_26: 49_000,
      bb_upper: 52_000,
      bb_lower: 48_000,
      bb_position: 'middle',
    },
    createdAt: '2024-01-01T00:05:00.000Z',
  };
}

/**
 * Configures mockSend for the standard single-bot handler flow:
 *   1. ScanCommand    — one page returning `bots`
 *   2. QueryCommand   — price history lookup for the pair (returns `currentPrice`)
 *   3. QueryCommand   — trades for the bot (returns `trades`)
 *   4. PutCommand     — performance snapshot write
 *
 * Because priceLookups and writes both use Promise.all internally, the order
 * of DDB calls is: Scan → Query (price) → Query (trades) → Put.
 * For a single bot this order is deterministic.
 */
function mockSingleBotFlow(
  bots: BotRecord[],
  currentPrice: number,
  trades: TradeRecord[],
): void {
  // 1. Scan page — returns bots with no pagination
  mockSend.mockResolvedValueOnce({ Items: bots, LastEvaluatedKey: undefined });
  // 2. Price history query for the pair
  mockSend.mockResolvedValueOnce({ Items: [{ price: currentPrice }], LastEvaluatedKey: undefined });
  // 3. Trades query for the bot
  mockSend.mockResolvedValueOnce({ Items: trades, LastEvaluatedKey: undefined });
  // 4. Performance snapshot write
  mockSend.mockResolvedValueOnce({});
}

// ─── bot-performance-recorder handler ────────────────────────────────────────

describe('bot-performance-recorder handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const { ScanCommand, QueryCommand, PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as {
      ScanCommand: jest.Mock;
      QueryCommand: jest.Mock;
      PutCommand: jest.Mock;
    };
    ScanCommand.mockImplementation((params: object) => ({ ...params, _type: 'Scan' }));
    QueryCommand.mockImplementation((params: object) => ({ ...params, _type: 'Query' }));
    PutCommand.mockImplementation((params: object) => ({ ...params, _type: 'Put' }));

    process.env.BOTS_TABLE_NAME = 'bots-table';
    process.env.TRADES_TABLE_NAME = 'trades-table';
    process.env.PRICE_HISTORY_TABLE_NAME = 'price-history-table';
    process.env.BOT_PERFORMANCE_TABLE_NAME = 'bot-performance-table';
  });

  // ── no active bots ────────────────────────────────────────────────────────

  /**
   * When there are no active bots, the handler should complete without
   * writing any performance snapshots.
   */
  it('should skip writing snapshots when there are no active bots', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).not.toHaveBeenCalled();
  });

  // ── calculatePnl: no buys, only sells → realisedPnl must be 0 ────────────

  /**
   * Guard against the pre-fix bug: when a bot has sell trades but no buy
   * trades, avgBuyCost is 0 which would make every sell look like pure profit.
   * After the fix, realisedPnl must be 0 in this scenario.
   */
  it('should set realisedPnl to 0 when there are sells but no buys', async () => {
    const bot = buildBot();
    const sellTrades = [
      buildTrade('sell', 50_000),
      buildTrade('sell', 51_000),
    ];

    mockSingleBotFlow([bot], 50_000, sellTrades);

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).toHaveBeenCalledTimes(1);
    const snapshot = PutCommand.mock.calls[0][0].Item;
    expect(snapshot.realisedPnl).toBe(0);
    expect(snapshot.totalSells).toBe(2);
    expect(snapshot.totalBuys).toBe(0);
    expect(snapshot.netPnl).toBe(0); // realisedPnl + unrealisedPnl (no open position)
  });

  /**
   * When there are no trades at all, all P&L metrics should be zero.
   */
  it('should return zero P&L metrics when there are no trades', async () => {
    const bot = buildBot();
    mockSingleBotFlow([bot], 50_000, []);

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const snapshot = PutCommand.mock.calls[0][0].Item;
    expect(snapshot.totalBuys).toBe(0);
    expect(snapshot.totalSells).toBe(0);
    expect(snapshot.realisedPnl).toBe(0);
    expect(snapshot.unrealisedPnl).toBe(0);
    expect(snapshot.netPnl).toBe(0);
    expect(snapshot.winRate).toBe(0);
  });

  // ── calculatePnl: normal buy + sell cycle ─────────────────────────────────

  /**
   * A complete buy-then-sell cycle: bought at 40,000, sold at 50,000.
   * realisedPnl = 50,000 − 40,000 = 10,000.
   */
  it('should calculate positive realisedPnl for a profitable buy-sell cycle', async () => {
    const bot = buildBot();
    const trades = [
      buildTrade('buy', 40_000),
      buildTrade('sell', 50_000),
    ];

    mockSingleBotFlow([bot], 50_000, trades);

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const snapshot = PutCommand.mock.calls[0][0].Item;
    expect(snapshot.realisedPnl).toBe(10_000);
    expect(snapshot.totalBuys).toBe(1);
    expect(snapshot.totalSells).toBe(1);
    expect(snapshot.winRate).toBe(100);
  });

  /**
   * A buy at 50,000 with no matching sell — unrealised P&L reflects current
   * price vs entry cost.
   */
  it('should calculate unrealisedPnl for an open buy position', async () => {
    const bot = buildBot();
    const trades = [buildTrade('buy', 40_000)];

    mockSingleBotFlow([bot], 50_000, trades);

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const snapshot = PutCommand.mock.calls[0][0].Item;
    // netPosition = 1 (one buy, zero sells)
    // unrealisedPnl = 1 * (50,000 - 40,000) = 10,000
    expect(snapshot.unrealisedPnl).toBe(10_000);
    expect(snapshot.realisedPnl).toBe(0);
    expect(snapshot.netPnl).toBe(10_000);
    expect(snapshot.netPosition).toBe(1);
  });

  /**
   * A buy-sell where sell price < buy price — realisedPnl should be negative.
   */
  it('should calculate negative realisedPnl for a loss-making cycle', async () => {
    const bot = buildBot();
    const trades = [
      buildTrade('buy', 50_000),
      buildTrade('sell', 40_000),
    ];

    mockSingleBotFlow([bot], 40_000, trades);

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const snapshot = PutCommand.mock.calls[0][0].Item;
    expect(snapshot.realisedPnl).toBe(-10_000);
    expect(snapshot.winRate).toBe(0);
  });

  // ── snapshot record structure ─────────────────────────────────────────────

  /**
   * The written snapshot should contain the required identity fields.
   */
  it('should write snapshot with correct botId, sub, pair, and currentPrice', async () => {
    const bot = buildBot({ botId: 'bot-abc', sub: 'user-xyz', pair: 'ETH' });
    const trade = { ...buildTrade('buy', 3_000), botId: 'bot-abc', sub: 'user-xyz', pair: 'ETH' };

    mockSingleBotFlow([bot], 3_500, [trade]);

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const snapshot = PutCommand.mock.calls[0][0].Item;
    expect(snapshot.botId).toBe('bot-abc');
    expect(snapshot.sub).toBe('user-xyz');
    expect(snapshot.pair).toBe('ETH');
    expect(snapshot.currentPrice).toBe(3_500);
    expect(typeof snapshot.timestamp).toBe('string');
    expect(typeof snapshot.ttl).toBe('number');
  });

  /**
   * The snapshot should be written to the BOT_PERFORMANCE_TABLE_NAME table.
   */
  it('should write snapshot to BOT_PERFORMANCE_TABLE_NAME', async () => {
    process.env.BOT_PERFORMANCE_TABLE_NAME = 'perf-table';
    const bot = buildBot();
    mockSingleBotFlow([bot], 50_000, []);

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand.mock.calls[0][0].TableName).toBe('perf-table');
  });

  // ── pagination ────────────────────────────────────────────────────────────

  /**
   * The bot scan should follow pagination — when LastEvaluatedKey is set,
   * the handler must continue scanning until it is cleared.
   */
  it('should paginate the bot scan when LastEvaluatedKey is present', async () => {
    const bot1 = buildBot({ botId: 'bot-1' });
    const bot2 = buildBot({ botId: 'bot-2' });

    // Page 1 of scan — contains bot1 with a continuation key
    mockSend.mockResolvedValueOnce({ Items: [bot1], LastEvaluatedKey: { sub: 'user-1', botId: 'bot-1' } });
    // Page 2 of scan — contains bot2 with no continuation key
    mockSend.mockResolvedValueOnce({ Items: [bot2], LastEvaluatedKey: undefined });

    // Both bots share the same pair — one price lookup
    mockSend.mockResolvedValueOnce({ Items: [{ price: 50_000 }] });
    // Trades for bot1
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    // Trades for bot2
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    // Snapshot writes
    mockSend.mockResolvedValue({});

    await handler(SCHEDULED_EVENT);

    const { ScanCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { ScanCommand: jest.Mock };
    expect(ScanCommand).toHaveBeenCalledTimes(2);
  });

  // ── error resilience ──────────────────────────────────────────────────────

  /**
   * A failure writing the snapshot for one bot must not abort snapshot
   * recording for the remaining bots.
   */
  it('should continue processing remaining bots when one bot write fails', async () => {
    const bot1 = buildBot({ botId: 'bot-fail' });
    const bot2 = buildBot({ botId: 'bot-ok' });

    mockSend.mockResolvedValueOnce({ Items: [bot1, bot2], LastEvaluatedKey: undefined });
    // Price lookup for BTC (shared pair)
    mockSend.mockResolvedValueOnce({ Items: [{ price: 50_000 }] });
    // Trades for bot1
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    // Trades for bot2
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    // PutCommand for bot1 — fails
    mockSend.mockRejectedValueOnce(new Error('DynamoDB write error'));
    // PutCommand for bot2 — succeeds
    mockSend.mockResolvedValueOnce({});

    await expect(handler(SCHEDULED_EVENT)).resolves.toBeUndefined();

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    // Both writes were attempted
    expect(PutCommand).toHaveBeenCalledTimes(2);
  });
});
