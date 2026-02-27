import { buildEvent } from '../../test-utils';

// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockDdbSend = jest.fn();
const mockSfnSend = jest.fn();
const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockDdbSend }) },
  GetCommand: jest.fn().mockImplementation((input) => ({ input })),
  PutCommand: jest.fn().mockImplementation((input) => ({ input })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({ send: mockSfnSend })),
  StartExecutionCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { submitBacktest } from '../routes/submit-backtest';
import { listBacktests } from '../routes/list-backtests';
import { getLatestBacktest } from '../routes/get-latest-backtest';
import { getBacktest } from '../routes/get-backtest';

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

const sampleBot = {
  sub: 'user-123',
  botId: 'b1',
  name: 'Test Bot',
  pair: 'BTC',
  status: 'active',
  executionMode: 'condition_cooldown',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const sampleMeta = {
  sub: 'user-123',
  backtestId: 'bt1',
  botId: 'b1',
  status: 'pending',
  botConfigSnapshot: sampleBot,
  configChangedSinceTest: false,
  testedAt: '2024-01-01T00:00:00.000Z',
  windowStart: '2023-12-01T00:00:00.000Z',
  windowEnd: '2024-01-01T00:00:00.000Z',
};

// ─── submitBacktest ───────────────────────────────────────────────────────────

describe('submitBacktest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOTS_TABLE_NAME = 'bots';
    process.env.BACKTESTS_TABLE_NAME = 'backtests';
    process.env.PRICE_HISTORY_TABLE_NAME = 'price-history';
    process.env.BACKTEST_WORKFLOW_ARN = 'arn:aws:states:us-east-1:123:stateMachine:bt';
    mockSfnSend.mockResolvedValue({});
  });

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await submitBacktest(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when botId is missing.
   */
  it('should return 400 when botId is missing', async () => {
    const result = await submitBacktest(authedEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing botId');
  });

  /**
   * Should return 404 when bot does not belong to user.
   */
  it('should return 404 when bot not found', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });
    const result = await submitBacktest(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(404);
  });

  /**
   * Should return 409 when a backtest is already in progress.
   */
  it('should return 409 when a backtest is already in progress', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Items: [{ ...sampleMeta, status: 'running' }] });
    const result = await submitBacktest(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toContain('already in progress');
  });

  /**
   * Should return 400 when insufficient price history is available.
   */
  it('should return 400 when insufficient price history', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Items: [] }) // no in-flight backtest
      .mockResolvedValueOnce({ Items: [] }); // no price history
    const result = await submitBacktest(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Insufficient price history');
  });

  /**
   * Should return 202 with backtestId and status on success.
   */
  it('should return 202 with backtestId on success', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [{ pair: 'BTC', timestamp: '2023-12-02T00:00:00.000Z' }] })
      .mockResolvedValueOnce({}); // PutCommand
    const result = await submitBacktest(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(202);
    const body = JSON.parse(result.body);
    expect(body.backtestId).toBeDefined();
    expect(body.status).toBe('pending');
  });
});

// ─── listBacktests ────────────────────────────────────────────────────────────

describe('listBacktests', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await listBacktests(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when botId is missing.
   */
  it('should return 400 when botId is missing', async () => {
    const result = await listBacktests(authedEvent());
    expect(result.statusCode).toBe(400);
  });

  /**
   * Should return 404 when bot not found.
   */
  it('should return 404 when bot not found', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });
    const result = await listBacktests(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(404);
  });

  /**
   * Should return 200 with list of backtest metadata records on success.
   */
  it('should return 200 with backtest metadata list on success', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Items: [sampleMeta] });
    const result = await listBacktests(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].backtestId).toBe('bt1');
  });
});

// ─── getLatestBacktest ────────────────────────────────────────────────────────

describe('getLatestBacktest', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await getLatestBacktest(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when botId is missing.
   */
  it('should return 400 when botId is missing', async () => {
    const result = await getLatestBacktest(authedEvent());
    expect(result.statusCode).toBe(400);
  });

  /**
   * Should return 404 when bot not found.
   */
  it('should return 404 when bot not found', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });
    const result = await getLatestBacktest(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(404);
  });

  /**
   * Should return 404 when no backtests found for bot.
   */
  it('should return 404 when no backtests for bot', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Items: [] });
    const result = await getLatestBacktest(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toContain('No backtests found');
  });

  /**
   * Should return 200 with pending backtest metadata when status is pending.
   */
  it('should return 200 with pending metadata', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Items: [sampleMeta] });
    const result = await getLatestBacktest(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).status).toBe('pending');
  });

  /**
   * Should return 200 with summary when status is completed and S3 report is available.
   */
  it('should return 200 with summary for completed backtest', async () => {
    const completedMeta = { ...sampleMeta, status: 'completed', s3Key: 'backtests/user-123/bt1.json' };
    const report = {
      backtestId: 'bt1',
      summary: { netPnl: 500, winRate: 75, totalTrades: 10, totalBuys: 5, totalSells: 5, largestGain: 100, largestLoss: -50, avgHoldTimeMinutes: 30 },
    };
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Items: [completedMeta] });
    mockS3Send.mockResolvedValueOnce({
      Body: { transformToString: async () => JSON.stringify(report) },
    });
    const result = await getLatestBacktest(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.summary.netPnl).toBe(500);
  });
});

// ─── getBacktest ──────────────────────────────────────────────────────────────

describe('getBacktest', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await getBacktest(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when botId is missing.
   */
  it('should return 400 when botId is missing', async () => {
    const result = await getBacktest(authedEvent({ pathParameters: { backtestId: 'bt1' } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing botId');
  });

  /**
   * Should return 400 when backtestId is missing.
   */
  it('should return 400 when backtestId is missing', async () => {
    const result = await getBacktest(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing backtestId');
  });

  /**
   * Should return 404 when bot not found.
   */
  it('should return 404 when bot not found', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });
    const result = await getBacktest(authedEvent({ pathParameters: { botId: 'b1', backtestId: 'bt1' } }));
    expect(result.statusCode).toBe(404);
  });

  /**
   * Should return 404 when backtest metadata not found.
   */
  it('should return 404 when backtest not found', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Item: undefined });
    const result = await getBacktest(authedEvent({ pathParameters: { botId: 'b1', backtestId: 'bt1' } }));
    expect(result.statusCode).toBe(404);
  });

  /**
   * Should return 404 when backtest belongs to a different bot.
   */
  it('should return 404 when backtest belongs to different bot', async () => {
    const wrongBotMeta = { ...sampleMeta, botId: 'other-bot' };
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Item: wrongBotMeta });
    const result = await getBacktest(authedEvent({ pathParameters: { botId: 'b1', backtestId: 'bt1' } }));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toContain('not found for this bot');
  });

  /**
   * Should return 200 with in-progress message when backtest is still running.
   */
  it('should return 200 with in-progress message when pending', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Item: sampleMeta });
    const result = await getBacktest(authedEvent({ pathParameters: { botId: 'b1', backtestId: 'bt1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).message).toContain('in progress');
  });

  /**
   * Should return 200 with full report when backtest is completed.
   */
  it('should return 200 with full report on completed backtest', async () => {
    const completedMeta = { ...sampleMeta, status: 'completed', s3Key: 'backtests/user-123/bt1.json' };
    const report = {
      backtestId: 'bt1',
      summary: { netPnl: 200 },
      hourlyBuckets: [],
    };
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Item: completedMeta });
    mockS3Send.mockResolvedValueOnce({
      Body: { transformToString: async () => JSON.stringify(report) },
    });
    const result = await getBacktest(authedEvent({ pathParameters: { botId: 'b1', backtestId: 'bt1' } }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.report.summary.netPnl).toBe(200);
  });

  /**
   * Should return 500 when S3 fetch fails.
   */
  it('should return 500 when S3 fetch fails', async () => {
    const completedMeta = { ...sampleMeta, status: 'completed', s3Key: 'backtests/user-123/bt1.json' };
    mockDdbSend
      .mockResolvedValueOnce({ Item: sampleBot })
      .mockResolvedValueOnce({ Item: completedMeta });
    mockS3Send.mockRejectedValueOnce(new Error('S3 error'));
    const result = await getBacktest(authedEvent({ pathParameters: { botId: 'b1', backtestId: 'bt1' } }));
    expect(result.statusCode).toBe(500);
  });
});
