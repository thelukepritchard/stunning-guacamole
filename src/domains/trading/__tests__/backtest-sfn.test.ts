const mockDdbSend = jest.fn();
const mockS3Send = jest.fn();
const mockEventBridgeSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDdbSend })) },
  GetCommand: jest.fn((params) => ({ ...params, _type: 'Get' })),
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
  UpdateCommand: jest.fn((params) => ({ ...params, _type: 'Update' })),
  DeleteCommand: jest.fn((params) => ({ ...params, _type: 'Delete' })),
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((params) => ({ ...params, _type: 'PutObject' })),
  DeleteObjectCommand: jest.fn((params) => ({ ...params, _type: 'DeleteObject' })),
}));
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn((params) => ({ ...params, _type: 'PutEvents' })),
}));

import { handler as validateHandler } from '../async/backtest-validate';
import { handler as writeReportHandler } from '../async/backtest-write-report';
import type { BotRecord } from '../types';

/** Minimal bot record used across tests. */
const mockBot: BotRecord = {
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

/** Standard validate step input. */
const baseValidateInput = {
  backtestId: 'bt-001',
  sub: 'user-123',
  botId: 'bot-001',
  botConfigSnapshot: mockBot,
  windowStart: '2025-12-02T00:00:00.000Z',
  windowEnd: '2026-01-01T00:00:00.000Z',
  waitSeconds: 420,
};

/** Minimal backtest report used for write-report tests. */
const mockReport = {
  backtestId: 'bt-001',
  botId: 'bot-001',
  sub: 'user-123',
  windowStart: '2025-12-02T00:00:00.000Z',
  windowEnd: '2026-01-01T00:00:00.000Z',
  sizingMode: 'configured' as const,
  botConfigSnapshot: mockBot,
  summary: {
    netPnl: 100,
    winRate: 50,
    totalTrades: 4,
    totalBuys: 2,
    totalSells: 2,
    largestGain: 120,
    largestLoss: -20,
    avgHoldTimeMinutes: 60,
  },
  hourlyBuckets: [],
};

/** Standard write-report step input. */
const baseWriteReportInput = {
  backtestId: 'bt-001',
  sub: 'user-123',
  botId: 'bot-001',
  windowStart: '2025-12-02T00:00:00.000Z',
  windowEnd: '2026-01-01T00:00:00.000Z',
  report: mockReport,
};

/**
 * Tests for the Step Functions backtest handlers:
 * backtest-validate and backtest-write-report.
 */
describe('Step Functions backtest handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOTS_TABLE_NAME = 'BotsTable';
    process.env.BACKTESTS_TABLE_NAME = 'BacktestsTable';
    process.env.BACKTEST_REPORTS_BUCKET = 'backtest-reports-bucket';
  });

  // ─── backtest-validate ─────────────────────────────────────────

  /**
   * Tests for the backtest-validate Step Functions handler.
   */
  describe('backtest-validate handler', () => {
    /** Verifies the handler returns the validated context when bot exists and no concurrent backtest. */
    it('returns validated context when bot exists and no concurrent backtest is running', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot }); // GetCommand — bot lookup
      mockDdbSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand — inflight check
      mockDdbSend.mockResolvedValueOnce({}); // UpdateCommand — status to running

      const result = await validateHandler(baseValidateInput);

      expect(result.backtestId).toBe('bt-001');
      expect(result.sub).toBe('user-123');
      expect(result.botId).toBe('bot-001');
      expect(result.waitSeconds).toBe(420);
    });

    /** Verifies the metadata status is updated to 'running' on success. */
    it('updates the backtest status to running', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [] });
      mockDdbSend.mockResolvedValueOnce({});

      await validateHandler(baseValidateInput);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      const updateCall = UpdateCommand.mock.calls[0][0];

      expect(updateCall.TableName).toBe('BacktestsTable');
      expect(updateCall.Key).toEqual({ sub: 'user-123', backtestId: 'bt-001' });
      expect(updateCall.ExpressionAttributeValues[':running']).toBe('running');
    });

    /** Verifies the inflight query excludes the current backtest by ID. */
    it('excludes the current backtestId from the inflight check', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [] });
      mockDdbSend.mockResolvedValueOnce({});

      await validateHandler(baseValidateInput);

      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const inflightQuery = QueryCommand.mock.calls[0][0];

      expect(inflightQuery.FilterExpression).toContain(':backtestId');
      expect(inflightQuery.ExpressionAttributeValues[':backtestId']).toBe('bt-001');
    });

    /** Verifies the handler throws when the bot is not found. */
    it('throws when bot is not found', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand — bot not found

      await expect(validateHandler(baseValidateInput)).rejects.toThrow(
        'Bot not found or does not belong to user',
      );
    });

    /** Verifies the handler throws when another backtest is already in-flight for the bot. */
    it('throws when another backtest is already running for the same bot', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ // QueryCommand — another backtest in-flight
        Items: [{ backtestId: 'bt-other', status: 'running', botId: 'bot-001', sub: 'user-123' }],
      });

      await expect(validateHandler(baseValidateInput)).rejects.toThrow(
        'Another backtest is already in progress',
      );
    });

    /** Verifies the returned object contains botConfigSnapshot for downstream steps. */
    it('returns botConfigSnapshot for downstream engine step', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: mockBot });
      mockDdbSend.mockResolvedValueOnce({ Items: [] });
      mockDdbSend.mockResolvedValueOnce({});

      const result = await validateHandler(baseValidateInput);

      expect(result.botConfigSnapshot).toEqual(mockBot);
      expect(result.windowStart).toBe(baseValidateInput.windowStart);
      expect(result.windowEnd).toBe(baseValidateInput.windowEnd);
    });
  });

  // ─── backtest-write-report ─────────────────────────────────────

  /**
   * Tests for the backtest-write-report Step Functions handler (success path).
   */
  describe('backtest-write-report handler — success path', () => {
    /** Verifies the report is serialised and written to S3 under the correct key. */
    it('writes the report to S3 under the correct key', async () => {
      mockS3Send.mockResolvedValueOnce({}); // PutObjectCommand
      mockDdbSend.mockResolvedValueOnce({}); // UpdateCommand — mark completed
      mockDdbSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand — rolling cap check
      mockEventBridgeSend.mockResolvedValueOnce({}); // BacktestCompleted event

      await writeReportHandler(baseWriteReportInput);

      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      const s3Call = PutObjectCommand.mock.calls[0][0];

      expect(s3Call.Bucket).toBe('backtest-reports-bucket');
      expect(s3Call.Key).toBe('backtests/user-123/bot-001/bt-001.json');
      expect(s3Call.ContentType).toBe('application/json');
      expect(JSON.parse(s3Call.Body)).toEqual(mockReport);
    });

    /** Verifies the DynamoDB metadata is updated to 'completed' with s3Key and completedAt. */
    it('updates the DynamoDB record to completed with s3Key and completedAt', async () => {
      mockS3Send.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({ Items: [] });
      mockEventBridgeSend.mockResolvedValueOnce({});

      await writeReportHandler(baseWriteReportInput);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      const updateCall = UpdateCommand.mock.calls[0][0];

      expect(updateCall.TableName).toBe('BacktestsTable');
      expect(updateCall.Key).toEqual({ sub: 'user-123', backtestId: 'bt-001' });
      expect(updateCall.ExpressionAttributeValues[':completed']).toBe('completed');
      expect(updateCall.ExpressionAttributeValues[':s3Key']).toBe('backtests/user-123/bot-001/bt-001.json');
      expect(updateCall.ExpressionAttributeValues[':completedAt']).toBeDefined();
    });

    /** Verifies the BacktestCompleted EventBridge event is published. */
    it('publishes BacktestCompleted event to EventBridge', async () => {
      mockS3Send.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({ Items: [] });
      mockEventBridgeSend.mockResolvedValueOnce({});

      await writeReportHandler(baseWriteReportInput);

      const { PutEventsCommand } = require('@aws-sdk/client-eventbridge');
      const ebCall = PutEventsCommand.mock.calls[0][0];
      const entry = ebCall.Entries[0];

      expect(entry.Source).toBe('signalr.trading');
      expect(entry.DetailType).toBe('BacktestCompleted');
      const detail = JSON.parse(entry.Detail);
      expect(detail.backtestId).toBe('bt-001');
      expect(detail.botId).toBe('bot-001');
      expect(detail.status).toBe('completed');
    });

    /** Verifies the handler returns confirmation with status and s3Key. */
    it('returns completed status and s3Key', async () => {
      mockS3Send.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({ Items: [] });
      mockEventBridgeSend.mockResolvedValueOnce({});

      const result = await writeReportHandler(baseWriteReportInput);

      expect(result.status).toBe('completed');
      expect(result.backtestId).toBe('bt-001');
      expect(result.s3Key).toBe('backtests/user-123/bot-001/bt-001.json');
    });

    /** Verifies old records beyond MAX_RESULTS_PER_BOT (5) are deleted. */
    it('deletes oldest records when more than 5 results exist per bot', async () => {
      // Simulate 7 existing records (2 should be pruned)
      const existingRecords = Array.from({ length: 7 }, (_, i) => ({
        sub: 'user-123',
        backtestId: `bt-old-${i}`,
        botId: 'bot-001',
        status: 'completed',
        s3Key: `backtests/user-123/bot-001/bt-old-${i}.json`,
        testedAt: `2025-12-0${i + 1}T00:00:00.000Z`,
      }));

      mockS3Send.mockResolvedValue({}); // All S3 calls succeed
      mockDdbSend.mockResolvedValueOnce({}); // UpdateCommand — mark completed
      mockDdbSend.mockResolvedValueOnce({ Items: existingRecords }); // QueryCommand — rolling cap
      // 2 old records will be deleted: S3 delete + DDB delete for each
      mockDdbSend.mockResolvedValue({}); // All subsequent DDB deletes

      await writeReportHandler(baseWriteReportInput);

      const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
      // Expect exactly 2 DDB deletes for the 2 oldest records
      expect(DeleteCommand).toHaveBeenCalledTimes(2);
      expect(DeleteCommand.mock.calls[0][0].Key.backtestId).toBe('bt-old-0');
      expect(DeleteCommand.mock.calls[1][0].Key.backtestId).toBe('bt-old-1');
    });

    /** Verifies no records are deleted when exactly 5 results exist. */
    it('does not delete records when exactly 5 results exist', async () => {
      const existingRecords = Array.from({ length: 5 }, (_, i) => ({
        sub: 'user-123',
        backtestId: `bt-old-${i}`,
        botId: 'bot-001',
        status: 'completed',
      }));

      mockS3Send.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({ Items: existingRecords });
      mockEventBridgeSend.mockResolvedValueOnce({});

      await writeReportHandler(baseWriteReportInput);

      const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
      expect(DeleteCommand).not.toHaveBeenCalled();
    });

    /** Verifies the handler completes successfully even when EventBridge publish fails. */
    it('completes successfully when EventBridge publish fails', async () => {
      mockS3Send.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({ Items: [] });
      mockEventBridgeSend.mockRejectedValueOnce(new Error('EventBridge error'));

      const result = await writeReportHandler(baseWriteReportInput);

      expect(result.status).toBe('completed');
    });

    /** Verifies S3 delete errors for old records do not abort the handler. */
    it('continues when S3 deletion of old records fails', async () => {
      const existingRecords = Array.from({ length: 6 }, (_, i) => ({
        sub: 'user-123',
        backtestId: `bt-old-${i}`,
        botId: 'bot-001',
        status: 'completed',
        s3Key: `backtests/user-123/bot-001/bt-old-${i}.json`,
      }));

      mockS3Send.mockResolvedValueOnce({}); // PutObjectCommand — success
      mockDdbSend.mockResolvedValueOnce({}); // UpdateCommand — mark completed
      mockDdbSend.mockResolvedValueOnce({ Items: existingRecords }); // rolling cap query
      mockS3Send.mockRejectedValueOnce(new Error('S3 delete failed')); // S3 delete — fails for oldest
      mockDdbSend.mockResolvedValueOnce({}); // DDB delete — still runs
      mockEventBridgeSend.mockResolvedValueOnce({});

      const result = await writeReportHandler(baseWriteReportInput);

      expect(result.status).toBe('completed');
    });
  });

  /**
   * Tests for the backtest-write-report Step Functions handler (failure path).
   */
  describe('backtest-write-report handler — failure path', () => {
    /** Verifies the DynamoDB record is updated to 'failed' with an error message. */
    it('marks backtest as failed and stores error message when failed=true', async () => {
      mockDdbSend.mockResolvedValueOnce({}); // UpdateCommand — mark failed

      const failureInput = {
        failed: true as const,
        error: 'States.TaskFailed',
        cause: 'No price history data available for the specified window',
        backtestId: 'bt-001',
        sub: 'user-123',
      };

      const result = await writeReportHandler(failureInput);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      const updateCall = UpdateCommand.mock.calls[0][0];

      expect(updateCall.TableName).toBe('BacktestsTable');
      expect(updateCall.Key).toEqual({ sub: 'user-123', backtestId: 'bt-001' });
      expect(updateCall.ExpressionAttributeValues[':failed']).toBe('failed');
      expect(updateCall.ExpressionAttributeValues[':errorMessage']).toBe(
        'No price history data available for the specified window',
      );

      expect(result.status).toBe('failed');
      expect(result.backtestId).toBe('bt-001');
    });

    /** Verifies the cause field is preferred over the error field for the error message. */
    it('uses cause over error field for the error message', async () => {
      mockDdbSend.mockResolvedValueOnce({});

      const failureInput = {
        failed: true as const,
        error: 'States.TaskFailed',
        cause: 'Detailed cause message',
        backtestId: 'bt-001',
        sub: 'user-123',
      };

      await writeReportHandler(failureInput);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      const updateCall = UpdateCommand.mock.calls[0][0];

      expect(updateCall.ExpressionAttributeValues[':errorMessage']).toBe('Detailed cause message');
    });

    /** Verifies 'Unknown error' is used when both error and cause are empty. */
    it('uses Unknown error when both error and cause are empty strings', async () => {
      mockDdbSend.mockResolvedValueOnce({});

      const failureInput = {
        failed: true as const,
        error: '',
        cause: '',
        backtestId: 'bt-001',
        sub: 'user-123',
      };

      await writeReportHandler(failureInput);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      const updateCall = UpdateCommand.mock.calls[0][0];

      expect(updateCall.ExpressionAttributeValues[':errorMessage']).toBe('Unknown error');
    });

    /** Verifies S3 and EventBridge are not called in the failure path. */
    it('does not write to S3 or publish EventBridge event in failure path', async () => {
      mockDdbSend.mockResolvedValueOnce({});

      const failureInput = {
        failed: true as const,
        error: 'States.TaskFailed',
        cause: 'Something went wrong',
        backtestId: 'bt-001',
        sub: 'user-123',
      };

      await writeReportHandler(failureInput);

      expect(mockS3Send).not.toHaveBeenCalled();
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });
  });
});
