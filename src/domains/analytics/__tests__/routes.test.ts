import { buildEvent } from '../../test-utils';

// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockDdbSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockDdbSend }) },
  QueryCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetCommand: jest.fn().mockImplementation((input) => ({ input })),
  ScanCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { getPortfolioPerformance } from '../routes/get-portfolio-performance';
import { getBotPerformance } from '../routes/get-bot-performance';
import { getLeaderboard } from '../routes/get-leaderboard';
import { getTraderProfile } from '../routes/get-trader-profile';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a minimal authenticated event stub.
 */
function authedEvent(overrides = {}) {
  return buildEvent({
    requestContext: {
      authorizer: { claims: { sub: 'user-123' } },
    } as never,
    ...overrides,
  });
}

// ─── getPortfolioPerformance ──────────────────────────────────────────────────

describe('getPortfolioPerformance', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await getPortfolioPerformance(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 for an invalid period.
   */
  it('should return 400 for invalid period', async () => {
    const result = await getPortfolioPerformance(authedEvent({
      queryStringParameters: { period: 'bad' },
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Invalid period');
  });

  /**
   * Should return 200 with items on success.
   */
  it('should return 200 with items on success', async () => {
    const snapshots = [{ sub: 'user-123', timestamp: '2024-01-01T00:00:00.000Z', totalNetPnl: 100 }];
    mockDdbSend.mockResolvedValueOnce({ Items: snapshots });
    const result = await getPortfolioPerformance(authedEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ items: snapshots });
  });

  /**
   * Should return 200 with valid periods.
   */
  it.each(['24h', '7d', '30d', 'all'])('should return 200 for period %s', async (period) => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    const result = await getPortfolioPerformance(authedEvent({
      queryStringParameters: { period },
    }));
    expect(result.statusCode).toBe(200);
  });
});

// ─── getBotPerformance ────────────────────────────────────────────────────────

describe('getBotPerformance', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await getBotPerformance(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when botId is missing.
   */
  it('should return 400 when botId is missing', async () => {
    const result = await getBotPerformance(authedEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing botId');
  });

  /**
   * Should return 404 when bot does not belong to the user.
   */
  it('should return 404 when bot not found', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });
    const result = await getBotPerformance(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(404);
  });

  /**
   * Should return 400 for an invalid period.
   */
  it('should return 400 for invalid period', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { botId: 'b1' } });
    const result = await getBotPerformance(authedEvent({
      pathParameters: { botId: 'b1' },
      queryStringParameters: { period: 'bad' },
    }));
    expect(result.statusCode).toBe(400);
  });

  /**
   * Should return 200 with performance items on success.
   */
  it('should return 200 with items on success', async () => {
    const bot = { botId: 'b1' };
    const perf = [{ botId: 'b1', timestamp: '2024-01-01T00:00:00.000Z', netPnl: 50 }];
    mockDdbSend
      .mockResolvedValueOnce({ Item: bot })
      .mockResolvedValueOnce({ Items: perf });
    const result = await getBotPerformance(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ items: perf });
  });
});

// ─── getLeaderboard ───────────────────────────────────────────────────────────

describe('getLeaderboard', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 200 with empty items when no users exist.
   */
  it('should return 200 with empty items when no users', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    const result = await getLeaderboard(buildEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ items: [] });
  });

  /**
   * Should return ranked entries sorted by 24h P&L descending.
   */
  it('should return ranked entries sorted by pnl24h descending', async () => {
    const users = [
      { sub: 'u1', username: 'alice' },
      { sub: 'u2', username: 'bob' },
    ];
    mockDdbSend
      .mockResolvedValueOnce({ Items: users, LastEvaluatedKey: undefined }) // ScanCommand
      .mockResolvedValueOnce({ Items: [{ pnl24h: 10, activeBots: 1, totalNetPnl: 10, timestamp: 't' }] })
      .mockResolvedValueOnce({ Items: [{ pnl24h: 50, activeBots: 2, totalNetPnl: 50, timestamp: 't' }] });

    const result = await getLeaderboard(buildEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items[0].username).toBe('bob');
    expect(body.items[0].rank).toBe(1);
    expect(body.items[1].username).toBe('alice');
    expect(body.items[1].rank).toBe(2);
  });

  /**
   * Should cap results at 100 even when more users exist.
   */
  it('should cap results at limit of 20 by default', async () => {
    const users = Array.from({ length: 5 }, (_, i) => ({ sub: `u${i}`, username: `user${i}` }));
    mockDdbSend
      .mockResolvedValueOnce({ Items: users, LastEvaluatedKey: undefined })
      .mockResolvedValue({ Items: [{ pnl24h: 1, activeBots: 0, totalNetPnl: 1, timestamp: 't' }] });
    const result = await getLeaderboard(buildEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).items.length).toBeLessThanOrEqual(20);
  });
});

// ─── getTraderProfile ─────────────────────────────────────────────────────────

describe('getTraderProfile', () => {
  beforeEach(() => jest.resetAllMocks());

  /**
   * Should return 400 when username is missing.
   */
  it('should return 400 when username is missing', async () => {
    const result = await getTraderProfile(buildEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing username');
  });

  /**
   * Should return 400 when username exceeds 50 characters.
   */
  it('should return 400 when username is too long', async () => {
    const result = await getTraderProfile(buildEvent({
      pathParameters: { username: 'a'.repeat(51) },
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Invalid username');
  });

  /**
   * Should return 400 for invalid period.
   */
  it('should return 400 for invalid period', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [{ sub: 'u1', username: 'alice', createdAt: 'now' }] });
    const result = await getTraderProfile(buildEvent({
      pathParameters: { username: 'alice' },
      queryStringParameters: { period: 'bad' },
    }));
    expect(result.statusCode).toBe(400);
  });

  /**
   * Should return 404 when trader is not found.
   */
  it('should return 404 when trader not found', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    const result = await getTraderProfile(buildEvent({
      pathParameters: { username: 'ghost' },
    }));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toBe('Trader not found');
  });

  /**
   * Should return 200 with profile data including null summary when no performance records exist.
   */
  it('should return 200 with null summary when no performance records', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Items: [{ sub: 'u1', username: 'alice', createdAt: '2024-01-01' }] })
      .mockResolvedValueOnce({ Items: [] });
    const result = await getTraderProfile(buildEvent({
      pathParameters: { username: 'alice' },
    }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.username).toBe('alice');
    expect(body.summary).toBeNull();
    expect(body.performance).toEqual([]);
  });

  /**
   * Should return 200 with summary built from the latest snapshot.
   */
  it('should return 200 with summary from latest snapshot', async () => {
    const snap = {
      timestamp: '2024-01-02T00:00:00.000Z',
      activeBots: 2,
      totalNetPnl: 500,
      totalRealisedPnl: 400,
      totalUnrealisedPnl: 100,
      pnl24h: 50,
    };
    mockDdbSend
      .mockResolvedValueOnce({ Items: [{ sub: 'u1', username: 'alice', createdAt: '2024-01-01' }] })
      .mockResolvedValueOnce({ Items: [snap] });
    const result = await getTraderProfile(buildEvent({
      pathParameters: { username: 'alice' },
    }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.summary.activeBots).toBe(2);
    expect(body.summary.totalNetPnl).toBe(500);
  });
});
