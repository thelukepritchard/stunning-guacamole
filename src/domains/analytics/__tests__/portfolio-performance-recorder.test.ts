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
import type { BotPerformanceRecord } from '../../shared/types';
import { handler } from '../async/portfolio-performance-recorder';

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
 * Builds a minimal BotPerformanceRecord for testing.
 */
function buildBotPerf(overrides: Partial<BotPerformanceRecord> = {}): BotPerformanceRecord {
  return {
    botId: 'bot-1',
    timestamp: new Date().toISOString(),
    sub: 'user-1',
    pair: 'BTC',
    currentPrice: 50_000,
    totalBuys: 1,
    totalSells: 1,
    totalBuyValue: 40_000,
    totalSellValue: 50_000,
    realisedPnl: 10_000,
    unrealisedPnl: 0,
    netPnl: 10_000,
    netPosition: 0,
    winRate: 100,
    ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('portfolio-performance-recorder handler', () => {
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

    process.env.PORTFOLIO_TABLE_NAME = 'portfolio-table';
    process.env.BOT_PERFORMANCE_TABLE_NAME = 'bot-performance-table';
    process.env.PORTFOLIO_PERFORMANCE_TABLE_NAME = 'portfolio-performance-table';
  });

  // ── no users ─────────────────────────────────────────────────────────────────

  /**
   * When there are no registered users, the handler should skip without
   * writing any snapshots.
   */
  it('should skip when there are no registered users', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).not.toHaveBeenCalled();
  });

  // ── single user with bot performance ─────────────────────────────────────────

  /**
   * Should aggregate bot performance data and write a portfolio snapshot.
   */
  it('should aggregate bot performance and write portfolio snapshot for one user', async () => {
    // Scan: one user
    mockSend.mockResolvedValueOnce({
      Items: [{ sub: 'user-1', username: 'trader1', createdAt: '2024-01-01T00:00:00Z' }],
      LastEvaluatedKey: undefined,
    });

    // Bot performance query for user-1
    const botPerf = buildBotPerf({ netPnl: 5_000, realisedPnl: 3_000, unrealisedPnl: 2_000 });
    mockSend.mockResolvedValueOnce({ Items: [botPerf] });

    // 24h portfolio performance query (oldest snapshot from 24h ago)
    mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-1', totalNetPnl: 2_000 }] });

    // Put portfolio performance snapshot
    mockSend.mockResolvedValueOnce({});

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).toHaveBeenCalledTimes(1);
    const snapshot = PutCommand.mock.calls[0][0].Item;
    expect(snapshot.sub).toBe('user-1');
    expect(snapshot.activeBots).toBe(1);
    expect(snapshot.totalNetPnl).toBe(5_000);
    expect(snapshot.totalRealisedPnl).toBe(3_000);
    expect(snapshot.totalUnrealisedPnl).toBe(2_000);
    // pnl24h = currentNetPnl (5000) - snapshot24hAgo.totalNetPnl (2000) = 3000
    expect(snapshot.pnl24h).toBe(3_000);
    expect(typeof snapshot.ttl).toBe('number');
  });

  // ── deduplication by botId ───────────────────────────────────────────────────

  /**
   * When multiple snapshots exist for the same botId, only the latest
   * should be used (first in ScanIndexForward=false order).
   */
  it('should deduplicate bot performance records by botId', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ sub: 'user-1', username: 'trader1', createdAt: '2024-01-01T00:00:00Z' }],
      LastEvaluatedKey: undefined,
    });

    // Two records for the same bot — the first one (most recent) should win
    const perf1 = buildBotPerf({ botId: 'bot-1', netPnl: 10_000, realisedPnl: 8_000, unrealisedPnl: 2_000, timestamp: '2024-01-01T00:10:00Z' });
    const perf2 = buildBotPerf({ botId: 'bot-1', netPnl: 5_000, realisedPnl: 4_000, unrealisedPnl: 1_000, timestamp: '2024-01-01T00:05:00Z' });
    mockSend.mockResolvedValueOnce({ Items: [perf1, perf2] });

    // 24h query — no previous snapshot
    mockSend.mockResolvedValueOnce({ Items: [] });

    // Put snapshot
    mockSend.mockResolvedValueOnce({});

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const snapshot = PutCommand.mock.calls[0][0].Item;
    expect(snapshot.activeBots).toBe(1); // only 1 unique bot
    expect(snapshot.totalNetPnl).toBe(10_000); // latest record's value
  });

  // ── multiple bots aggregation ────────────────────────────────────────────────

  /**
   * Should sum P&L across multiple bots for a single user.
   */
  it('should sum P&L across multiple bots', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ sub: 'user-1', username: 'trader1', createdAt: '2024-01-01T00:00:00Z' }],
      LastEvaluatedKey: undefined,
    });

    const perf1 = buildBotPerf({ botId: 'bot-1', netPnl: 5_000, realisedPnl: 3_000, unrealisedPnl: 2_000 });
    const perf2 = buildBotPerf({ botId: 'bot-2', netPnl: -1_000, realisedPnl: -500, unrealisedPnl: -500 });
    mockSend.mockResolvedValueOnce({ Items: [perf1, perf2] });

    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const snapshot = PutCommand.mock.calls[0][0].Item;
    expect(snapshot.activeBots).toBe(2);
    expect(snapshot.totalNetPnl).toBe(4_000);
    expect(snapshot.totalRealisedPnl).toBe(2_500);
    expect(snapshot.totalUnrealisedPnl).toBe(1_500);
  });

  // ── 24h P&L — no previous snapshot ──────────────────────────────────────────

  /**
   * When there is no 24h-ago snapshot, pnl24h should equal current totalNetPnl.
   */
  it('should set pnl24h to totalNetPnl when no 24h snapshot exists', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ sub: 'user-1', username: 'trader1', createdAt: '2024-01-01T00:00:00Z' }],
      LastEvaluatedKey: undefined,
    });

    mockSend.mockResolvedValueOnce({ Items: [buildBotPerf({ netPnl: 7_000 })] });
    mockSend.mockResolvedValueOnce({ Items: [] }); // no 24h snapshot
    mockSend.mockResolvedValueOnce({});

    await handler(SCHEDULED_EVENT);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const snapshot = PutCommand.mock.calls[0][0].Item;
    expect(snapshot.pnl24h).toBe(7_000);
  });

  // ── user scan pagination ─────────────────────────────────────────────────────

  /**
   * Should paginate the user scan when LastEvaluatedKey is present.
   */
  it('should paginate the user scan', async () => {
    // Page 1
    mockSend.mockResolvedValueOnce({
      Items: [{ sub: 'user-1', username: 'trader1', createdAt: '2024-01-01T00:00:00Z' }],
      LastEvaluatedKey: { sub: 'user-1' },
    });
    // Page 2
    mockSend.mockResolvedValueOnce({
      Items: [{ sub: 'user-2', username: 'trader2', createdAt: '2024-01-01T00:00:00Z' }],
      LastEvaluatedKey: undefined,
    });

    // Bot perf for user-1
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Bot perf for user-2
    mockSend.mockResolvedValueOnce({ Items: [] });
    // 24h for user-1
    mockSend.mockResolvedValueOnce({ Items: [] });
    // 24h for user-2
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Put for user-1
    mockSend.mockResolvedValueOnce({});
    // Put for user-2
    mockSend.mockResolvedValueOnce({});

    await handler(SCHEDULED_EVENT);

    const { ScanCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { ScanCommand: jest.Mock };
    expect(ScanCommand).toHaveBeenCalledTimes(2);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).toHaveBeenCalledTimes(2);
  });

  // ── error resilience ─────────────────────────────────────────────────────────

  /**
   * A failure recording one user's portfolio snapshot should not abort
   * processing of other users.
   */
  it('should continue processing other users when one user fails', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { sub: 'user-fail', username: 'fail_user', createdAt: '2024-01-01T00:00:00Z' },
        { sub: 'user-ok', username: 'ok_user', createdAt: '2024-01-01T00:00:00Z' },
      ],
      LastEvaluatedKey: undefined,
    });

    // Bot perf for user-fail — throws
    mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));
    // Bot perf for user-ok
    mockSend.mockResolvedValueOnce({ Items: [] });
    // 24h for user-ok
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Put for user-ok
    mockSend.mockResolvedValueOnce({});

    await expect(handler(SCHEDULED_EVENT)).resolves.toBeUndefined();

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    // At least the successful user's snapshot was written
    expect(PutCommand).toHaveBeenCalledTimes(1);
  });
});
