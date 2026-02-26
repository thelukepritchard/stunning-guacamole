import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockDdbSend = jest.fn();
const mockSfnSend = jest.fn();
const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDdbSend })) },
  GetCommand: jest.fn((params) => ({ ...params, _type: 'Get' })),
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
  PutCommand: jest.fn((params) => ({ ...params, _type: 'Put' })),
  UpdateCommand: jest.fn((params) => ({ ...params, _type: 'Update' })),
}));
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSfnSend })),
  StartExecutionCommand: jest.fn((params) => ({ ...params, _type: 'StartExecution' })),
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((params) => ({ ...params, _type: 'GetObject' })),
}));

import { submitBacktest } from '../routes/submit-backtest';
import { listBacktests } from '../routes/list-backtests';
import { getLatestBacktest } from '../routes/get-latest-backtest';
import { getBacktest } from '../routes/get-backtest';

/**
 * Builds a mock API Gateway proxy event for backtest route tests.
 *
 * @param overrides - Partial event properties to merge into the defaults.
 * @returns A fully-formed mock API Gateway proxy event.
 */
function buildRouteEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    resource: '/trading/bots/{botId}/backtests',
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: '/trading/bots/bot-001/backtests',
    pathParameters: { botId: 'bot-001' },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      authorizer: { claims: { sub: 'user-123' } },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  };
}

/** Minimal bot record used across multiple tests. */
const mockBot = {
  sub: 'user-123',
  botId: 'bot-001',
  name: 'My Bot',
  pair: 'BTC/USDT',
  status: 'active',
  executionMode: 'condition_cooldown',
  buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
  buySizing: { type: 'fixed', value: 100 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** Completed backtest metadata record. */
const mockCompletedBacktest = {
  sub: 'user-123',
  backtestId: 'bt-001',
  botId: 'bot-001',
  status: 'completed',
  s3Key: 'backtests/user-123/bot-001/bt-001.json',
  botConfigSnapshot: mockBot,
  configChangedSinceTest: false,
  testedAt: '2026-01-01T01:00:00.000Z',
  completedAt: '2026-01-01T01:05:00.000Z',
  windowStart: '2025-12-02T01:00:00.000Z',
  windowEnd: '2026-01-01T01:00:00.000Z',
};

/** Pending backtest metadata record. */
const mockPendingBacktest = {
  ...mockCompletedBacktest,
  backtestId: 'bt-002',
  status: 'pending',
  s3Key: undefined,
};

/** Minimal backtest report stored in S3. */
const mockReport = {
  backtestId: 'bt-001',
  botId: 'bot-001',
  sub: 'user-123',
  windowStart: '2025-12-02T01:00:00.000Z',
  windowEnd: '2026-01-01T01:00:00.000Z',
  sizingMode: 'configured',
  botConfigSnapshot: mockBot,
  summary: {
    netPnl: 250.50,
    winRate: 66.67,
    totalTrades: 6,
    totalBuys: 3,
    totalSells: 3,
    largestGain: 150.00,
    largestLoss: -50.00,
    avgHoldTimeMinutes: 120,
  },
  hourlyBuckets: [],
};

/**
 * Tests for the backtest route handlers:
 * submitBacktest, listBacktests, getLatestBacktest, getBacktest.
 */
describe('backtest route handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOTS_TABLE_NAME = 'BotsTable';
    process.env.BACKTESTS_TABLE_NAME = 'BacktestsTable';
    process.env.PRICE_HISTORY_TABLE_NAME = 'PriceHistoryTable';
    process.env.BACKTEST_WORKFLOW_ARN = 'arn:aws:states:ap-southeast-2:123456789012:stateMachine:BacktestWorkflow';
    process.env.BACKTEST_REPORTS_BUCKET = 'backtest-reports-bucket';
  });

  // ─── submitBacktest ────────────────────────────────────────────

  /**
   * Tests for the submitBacktest route handler.
   */
  describe('submitBacktest', () => {
    /** Verifies a valid request returns 202 with backtestId and pending status. */
    it('returns 202 with backtestId and pending status when bot exists and data is sufficient', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot }); // GetCommand — bot lookup
      mockDdbSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand — inflight check
      mockDdbSend.mockResolvedValueOnce({ Items: [{ pair: 'BTC/USDT', timestamp: '2025-12-01T00:00:00.000Z' }] }); // QueryCommand — price check
      mockDdbSend.mockResolvedValueOnce({}); // PutCommand — metadata write
      mockSfnSend.mockResolvedValueOnce({}); // StartExecutionCommand

      const event = buildRouteEvent({ httpMethod: 'POST' });

      const result = await submitBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(202);
      expect(body.backtestId).toBeDefined();
      expect(body.status).toBe('pending');
    });

    /** Verifies the DynamoDB PutCommand is called with the correct metadata shape. */
    it('writes a pending metadata record to DynamoDB with correct fields', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [] });
      mockDdbSend.mockResolvedValueOnce({ Items: [{ pair: 'BTC/USDT', timestamp: '2025-12-01T00:00:00.000Z' }] });
      mockDdbSend.mockResolvedValueOnce({});
      mockSfnSend.mockResolvedValueOnce({});

      const event = buildRouteEvent({ httpMethod: 'POST' });
      await submitBacktest(event);

      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      const putCall = PutCommand.mock.calls[0][0];

      expect(putCall.Item.sub).toBe('user-123');
      expect(putCall.Item.botId).toBe('bot-001');
      expect(putCall.Item.status).toBe('pending');
      expect(putCall.Item.configChangedSinceTest).toBe(false);
      expect(putCall.Item.botConfigSnapshot).toEqual(mockBot);
      expect(putCall.Item.backtestId).toBeDefined();
      expect(putCall.Item.testedAt).toBeDefined();
      expect(putCall.Item.windowStart).toBeDefined();
      expect(putCall.Item.windowEnd).toBeDefined();
    });

    /** Verifies the Step Functions workflow is started with correct input. */
    it('starts the Step Functions workflow with backtestId and bot config', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [] });
      mockDdbSend.mockResolvedValueOnce({ Items: [{ pair: 'BTC/USDT', timestamp: '2025-12-01T00:00:00.000Z' }] });
      mockDdbSend.mockResolvedValueOnce({});
      mockSfnSend.mockResolvedValueOnce({});

      const event = buildRouteEvent({ httpMethod: 'POST' });
      await submitBacktest(event);

      const { StartExecutionCommand } = require('@aws-sdk/client-sfn');
      const sfnCall = StartExecutionCommand.mock.calls[0][0];

      expect(sfnCall.stateMachineArn).toBe(process.env.BACKTEST_WORKFLOW_ARN);
      const input = JSON.parse(sfnCall.input);
      expect(input.backtestId).toBeDefined();
      expect(input.sub).toBe('user-123');
      expect(input.botId).toBe('bot-001');
      expect(input.botConfigSnapshot).toEqual(mockBot);
      expect(input.windowStart).toBeDefined();
      expect(input.windowEnd).toBeDefined();
      expect(input.waitSeconds).toBeGreaterThanOrEqual(300);
      expect(input.waitSeconds).toBeLessThanOrEqual(600);
    });

    /** Verifies 401 is returned when sub is missing. */
    it('returns 401 when sub is missing', async () => {
      const event = buildRouteEvent({
        httpMethod: 'POST',
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await submitBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    /** Verifies 400 is returned when botId is missing. */
    it('returns 400 when botId is missing', async () => {
      const event = buildRouteEvent({
        httpMethod: 'POST',
        pathParameters: null,
      });

      const result = await submitBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toBe('Missing botId');
    });

    /** Verifies 404 is returned when the bot does not exist. */
    it('returns 404 when bot is not found', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand — bot not found

      const event = buildRouteEvent({ httpMethod: 'POST' });

      const result = await submitBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Bot not found');
    });

    /** Verifies 409 is returned when a backtest is already in-flight. */
    it('returns 409 when a backtest is already in progress', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot }); // GetCommand — bot found
      mockDdbSend.mockResolvedValueOnce({ // QueryCommand — inflight check returns existing
        Items: [{ ...mockPendingBacktest }],
      });

      const event = buildRouteEvent({ httpMethod: 'POST' });

      const result = await submitBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(409);
      expect(body.error).toContain('already in progress');
    });

    /** Verifies 400 is returned when there is insufficient price history. */
    it('returns 400 when price history has fewer than 7 days of data', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot }); // GetCommand — bot found
      mockDdbSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand — no inflight
      mockDdbSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand — no old price data

      const event = buildRouteEvent({ httpMethod: 'POST' });

      const result = await submitBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('Insufficient price history');
    });

    /** Verifies the inflight check queries the botId-index GSI with correct filters. */
    it('queries botId-index GSI with pending and running status filters for inflight check', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [] });
      mockDdbSend.mockResolvedValueOnce({ Items: [{ pair: 'BTC/USDT', timestamp: '2025-12-01T00:00:00.000Z' }] });
      mockDdbSend.mockResolvedValueOnce({});
      mockSfnSend.mockResolvedValueOnce({});

      const event = buildRouteEvent({ httpMethod: 'POST' });
      await submitBacktest(event);

      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const inflightQuery = QueryCommand.mock.calls[0][0];

      expect(inflightQuery.TableName).toBe('BacktestsTable');
      expect(inflightQuery.IndexName).toBe('botId-index');
      expect(inflightQuery.FilterExpression).toContain(':pending');
      expect(inflightQuery.FilterExpression).toContain(':running');
      expect(inflightQuery.ExpressionAttributeValues[':botId']).toBe('bot-001');
    });
  });

  // ─── listBacktests ─────────────────────────────────────────────

  /**
   * Tests for the listBacktests route handler.
   */
  describe('listBacktests', () => {
    /** Verifies a list of up to 5 backtest records is returned when the bot exists. */
    it('returns 200 with backtest list when bot exists', async () => {
      const backtests = [mockCompletedBacktest, mockPendingBacktest];
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot }); // GetCommand — bot
      mockDdbSend.mockResolvedValueOnce({ Items: backtests }); // QueryCommand — backtests

      const event = buildRouteEvent();

      const result = await listBacktests(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0].backtestId).toBe('bt-001');
    });

    /** Verifies an empty array is returned when no backtests exist. */
    it('returns 200 with empty array when no backtests exist', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [] });

      const event = buildRouteEvent();

      const result = await listBacktests(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body).toEqual([]);
    });

    /** Verifies the query uses botId-index GSI sorted newest first with Limit 5. */
    it('queries botId-index GSI sorted newest first with Limit 5', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [] });

      const event = buildRouteEvent();
      await listBacktests(event);

      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const query = QueryCommand.mock.calls[0][0];

      expect(query.IndexName).toBe('botId-index');
      expect(query.ScanIndexForward).toBe(false);
      expect(query.Limit).toBe(5);
    });

    /** Verifies 401 when sub is missing. */
    it('returns 401 when sub is missing', async () => {
      const event = buildRouteEvent({
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await listBacktests(event);
      expect(result.statusCode).toBe(401);
    });

    /** Verifies 400 when botId is missing. */
    it('returns 400 when botId is missing', async () => {
      const event = buildRouteEvent({ pathParameters: null });

      const result = await listBacktests(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toBe('Missing botId');
    });

    /** Verifies 404 when the bot is not found. */
    it('returns 404 when bot is not found', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: undefined });

      const event = buildRouteEvent();

      const result = await listBacktests(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Bot not found');
      expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });
  });

  // ─── getLatestBacktest ─────────────────────────────────────────

  /**
   * Tests for the getLatestBacktest route handler.
   */
  describe('getLatestBacktest', () => {
    /** Verifies metadata is returned without summary for a non-completed backtest. */
    it('returns 200 with metadata when backtest is pending', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [mockPendingBacktest] });

      const event = buildRouteEvent({ resource: '/trading/bots/{botId}/backtests/latest' });

      const result = await getLatestBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.backtestId).toBe('bt-002');
      expect(body.status).toBe('pending');
      expect(body.summary).toBeUndefined();
    });

    /** Verifies summary is included when the backtest is completed and S3 fetch succeeds. */
    it('returns 200 with summary from S3 when backtest is completed', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [mockCompletedBacktest] });
      mockS3Send.mockResolvedValueOnce({
        Body: { transformToString: jest.fn().mockResolvedValue(JSON.stringify(mockReport)) },
      });

      const event = buildRouteEvent({ resource: '/trading/bots/{botId}/backtests/latest' });

      const result = await getLatestBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.status).toBe('completed');
      expect(body.summary).toBeDefined();
      expect(body.summary.netPnl).toBe(250.50);
      expect(body.summary.winRate).toBe(66.67);
    });

    /** Verifies metadata is returned without summary when S3 fetch fails for a completed backtest. */
    it('returns metadata without summary when S3 fetch fails for a completed backtest', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [mockCompletedBacktest] });
      mockS3Send.mockRejectedValueOnce(new Error('S3 fetch failed'));

      const event = buildRouteEvent({ resource: '/trading/bots/{botId}/backtests/latest' });

      const result = await getLatestBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.backtestId).toBe('bt-001');
      expect(body.summary).toBeUndefined();
    });

    /** Verifies 404 when no backtests exist for the bot. */
    it('returns 404 when no backtests exist for this bot', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [] });

      const event = buildRouteEvent({ resource: '/trading/bots/{botId}/backtests/latest' });

      const result = await getLatestBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('No backtests found for this bot');
    });

    /** Verifies 401 when sub is missing. */
    it('returns 401 when sub is missing', async () => {
      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/latest',
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await getLatestBacktest(event);
      expect(result.statusCode).toBe(401);
    });

    /** Verifies 400 when botId is missing. */
    it('returns 400 when botId is missing', async () => {
      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/latest',
        pathParameters: null,
      });

      const result = await getLatestBacktest(event);
      expect(result.statusCode).toBe(400);
    });

    /** Verifies 404 when bot is not found. */
    it('returns 404 when bot is not found', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: undefined });

      const event = buildRouteEvent({ resource: '/trading/bots/{botId}/backtests/latest' });

      const result = await getLatestBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Bot not found');
    });

    /** Verifies the query uses botId-index GSI with Limit 1 sorted newest first. */
    it('queries botId-index GSI with Limit 1 sorted newest first', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [mockPendingBacktest] });

      const event = buildRouteEvent({ resource: '/trading/bots/{botId}/backtests/latest' });
      await getLatestBacktest(event);

      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const query = QueryCommand.mock.calls[0][0];

      expect(query.Limit).toBe(1);
      expect(query.ScanIndexForward).toBe(false);
    });
  });

  // ─── getBacktest ───────────────────────────────────────────────

  /**
   * Tests for the getBacktest route handler.
   */
  describe('getBacktest', () => {
    /** Verifies the full report is returned for a completed backtest. */
    it('returns 200 with full report when backtest is completed', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot }); // bot lookup
      mockDdbSend.mockResolvedValueOnce({ Item: mockCompletedBacktest }); // backtest lookup
      mockS3Send.mockResolvedValueOnce({
        Body: { transformToString: jest.fn().mockResolvedValue(JSON.stringify(mockReport)) },
      });

      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/{backtestId}',
        pathParameters: { botId: 'bot-001', backtestId: 'bt-001' },
      });

      const result = await getBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.backtestId).toBe('bt-001');
      expect(body.report).toBeDefined();
      expect(body.report.summary.netPnl).toBe(250.50);
    });

    /** Verifies in-progress message is returned for a pending backtest. */
    it('returns 200 with in-progress message when backtest is pending', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Item: mockPendingBacktest });

      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/{backtestId}',
        pathParameters: { botId: 'bot-001', backtestId: 'bt-002' },
      });

      const result = await getBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.message).toContain('still in progress');
      expect(body.report).toBeUndefined();
    });

    /** Verifies the failed message is returned for a failed backtest. */
    it('returns 200 with failure message when backtest failed', async () => {
      const failedBacktest = { ...mockCompletedBacktest, status: 'failed', s3Key: undefined };
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Item: failedBacktest });

      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/{backtestId}',
        pathParameters: { botId: 'bot-001', backtestId: 'bt-001' },
      });

      const result = await getBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.message).toBe('Backtest failed');
    });

    /** Verifies 404 when the backtest does not exist. */
    it('returns 404 when backtest is not found', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Item: undefined }); // backtest not found

      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/{backtestId}',
        pathParameters: { botId: 'bot-001', backtestId: 'nonexistent' },
      });

      const result = await getBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Backtest not found');
    });

    /** Verifies 404 when the backtest belongs to a different bot. */
    it('returns 404 when backtest belongs to a different bot', async () => {
      const backtestForOtherBot = { ...mockCompletedBacktest, botId: 'bot-999' };
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot }); // bot-001 found
      mockDdbSend.mockResolvedValueOnce({ Item: backtestForOtherBot }); // backtest for bot-999

      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/{backtestId}',
        pathParameters: { botId: 'bot-001', backtestId: 'bt-001' },
      });

      const result = await getBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Backtest not found for this bot');
    });

    /** Verifies 401 when sub is missing. */
    it('returns 401 when sub is missing', async () => {
      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/{backtestId}',
        pathParameters: { botId: 'bot-001', backtestId: 'bt-001' },
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await getBacktest(event);
      expect(result.statusCode).toBe(401);
    });

    /** Verifies 400 when botId is missing. */
    it('returns 400 when botId is missing', async () => {
      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/{backtestId}',
        pathParameters: { backtestId: 'bt-001' },
      });

      const result = await getBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toBe('Missing botId');
    });

    /** Verifies 400 when backtestId is missing. */
    it('returns 400 when backtestId is missing', async () => {
      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/{backtestId}',
        pathParameters: { botId: 'bot-001' },
      });

      const result = await getBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toBe('Missing backtestId');
    });

    /** Verifies 404 when bot is not found. */
    it('returns 404 when bot is not found', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: undefined });

      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/{backtestId}',
        pathParameters: { botId: 'bot-001', backtestId: 'bt-001' },
      });

      const result = await getBacktest(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Bot not found');
    });

    /** Verifies the S3 GetObjectCommand uses the correct bucket and key. */
    it('fetches the correct S3 object using bucket and s3Key from metadata', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Item: mockCompletedBacktest });
      mockS3Send.mockResolvedValueOnce({
        Body: { transformToString: jest.fn().mockResolvedValue(JSON.stringify(mockReport)) },
      });

      const event = buildRouteEvent({
        resource: '/trading/bots/{botId}/backtests/{backtestId}',
        pathParameters: { botId: 'bot-001', backtestId: 'bt-001' },
      });

      await getBacktest(event);

      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const s3Call = GetObjectCommand.mock.calls[0][0];

      expect(s3Call.Bucket).toBe('backtest-reports-bucket');
      expect(s3Call.Key).toBe('backtests/user-123/bot-001/bt-001.json');
    });
  });
});
