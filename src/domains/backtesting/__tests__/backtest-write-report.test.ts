// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockDdbSend = jest.fn();
const mockS3Send = jest.fn();
const mockEbSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockDdbSend }) },
  UpdateCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Update' })),
  QueryCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Query' })),
  DeleteCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Delete' })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'PutObject' })),
  DeleteObjectCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'DeleteObject' })),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEbSend })),
  PutEventsCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'PutEvents' })),
}));

import type { BacktestReport, BotRecord } from '../../shared/types';
import { handler } from '../async/backtest-write-report';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal BotRecord.
 */
function buildBot(): BotRecord {
  return {
    sub: 'user-1',
    botId: 'bot-1',
    name: 'Test Bot',
    pair: 'BTC',
    status: 'active',
    executionMode: 'once_and_wait',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

/** Builds a minimal backtest report. */
function buildReport(): BacktestReport {
  return {
    backtestId: 'bt-1',
    botId: 'bot-1',
    sub: 'user-1',
    windowStart: '2024-01-01T00:00:00Z',
    windowEnd: '2024-01-31T00:00:00Z',
    sizingMode: 'default_1000_aud',
    botConfigSnapshot: buildBot(),
    summary: {
      netPnl: 500,
      winRate: 60,
      totalTrades: 10,
      totalBuys: 5,
      totalSells: 5,
      largestGain: 200,
      largestLoss: -100,
      avgHoldTimeMinutes: 120,
    },
    hourlyBuckets: [],
  };
}

/** Builds a success input for the write-report handler. */
function buildSuccessInput() {
  return {
    backtestId: 'bt-1',
    sub: 'user-1',
    botId: 'bot-1',
    windowStart: '2024-01-01T00:00:00Z',
    windowEnd: '2024-01-31T00:00:00Z',
    report: buildReport(),
  };
}

/** Builds a failure input for the write-report handler. */
function buildFailureInput() {
  return {
    failed: true as const,
    error: 'StepFunction.Error',
    cause: 'Bot not found or does not belong to user',
    backtestId: 'bt-1',
    sub: 'user-1',
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('backtest-write-report handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const mock = jest.requireMock('@aws-sdk/lib-dynamodb') as {
      UpdateCommand: jest.Mock;
      QueryCommand: jest.Mock;
      DeleteCommand: jest.Mock;
    };
    mock.UpdateCommand.mockImplementation((params: object) => ({ ...params, _type: 'Update' }));
    mock.QueryCommand.mockImplementation((params: object) => ({ ...params, _type: 'Query' }));
    mock.DeleteCommand.mockImplementation((params: object) => ({ ...params, _type: 'Delete' }));

    const s3Mock = jest.requireMock('@aws-sdk/client-s3') as {
      PutObjectCommand: jest.Mock;
      DeleteObjectCommand: jest.Mock;
    };
    s3Mock.PutObjectCommand.mockImplementation((params: object) => ({ ...params, _type: 'PutObject' }));
    s3Mock.DeleteObjectCommand.mockImplementation((params: object) => ({ ...params, _type: 'DeleteObject' }));

    const ebMock = jest.requireMock('@aws-sdk/client-eventbridge') as { PutEventsCommand: jest.Mock };
    ebMock.PutEventsCommand.mockImplementation((params: object) => ({ ...params, _type: 'PutEvents' }));

    process.env.BACKTESTS_TABLE_NAME = 'backtests-table';
    process.env.BACKTEST_REPORTS_BUCKET = 'backtest-reports-bucket';
  });

  // ── failure handler ──────────────────────────────────────────────────────────

  /**
   * When invoked as a failure handler, should update the metadata status
   * to 'failed' with the error message.
   */
  it('should update status to failed with error message on failure input', async () => {
    mockDdbSend.mockResolvedValueOnce({});

    const result = await handler(buildFailureInput());

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      backtestId: 'bt-1',
    }));

    const { UpdateCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { UpdateCommand: jest.Mock };
    expect(UpdateCommand).toHaveBeenCalledTimes(1);
    const params = UpdateCommand.mock.calls[0][0];
    expect(params.Key).toEqual({ sub: 'user-1', backtestId: 'bt-1' });
    expect(params.ExpressionAttributeValues[':failed']).toBe('failed');
    expect(params.ExpressionAttributeValues[':errorMessage']).toBe(
      'Bot not found or does not belong to user',
    );
  });

  /**
   * Error messages longer than 500 characters should be truncated.
   */
  it('should truncate error messages longer than 500 characters', async () => {
    mockDdbSend.mockResolvedValueOnce({});

    const longCause = 'x'.repeat(600);
    const result = await handler({ ...buildFailureInput(), cause: longCause });

    const { UpdateCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { UpdateCommand: jest.Mock };
    const errorMessage = UpdateCommand.mock.calls[0][0].ExpressionAttributeValues[':errorMessage'];
    expect(errorMessage.length).toBe(500);
  });

  // ── success flow ─────────────────────────────────────────────────────────────

  /**
   * Should write report to S3, update DynamoDB metadata, and return completed.
   */
  it('should write S3 report, update DynamoDB, and publish event on success', async () => {
    // S3 PutObject
    mockS3Send.mockResolvedValueOnce({});
    // DynamoDB UpdateCommand (set status to completed)
    mockDdbSend.mockResolvedValueOnce({});
    // DynamoDB QueryCommand (rolling cap check — under limit)
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    // EventBridge PutEvents
    mockEbSend.mockResolvedValueOnce({});

    const result = await handler(buildSuccessInput());

    expect(result).toEqual(expect.objectContaining({
      status: 'completed',
      backtestId: 'bt-1',
    }));

    // Verify S3 write
    const { PutObjectCommand } = jest.requireMock('@aws-sdk/client-s3') as { PutObjectCommand: jest.Mock };
    expect(PutObjectCommand).toHaveBeenCalledTimes(1);
    const s3Params = PutObjectCommand.mock.calls[0][0];
    expect(s3Params.Bucket).toBe('backtest-reports-bucket');
    expect(s3Params.Key).toBe('backtests/user-1/bot-1/bt-1.json');
    expect(s3Params.ContentType).toBe('application/json');

    // Verify DynamoDB update
    const { UpdateCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { UpdateCommand: jest.Mock };
    expect(UpdateCommand).toHaveBeenCalledTimes(1);
    const updateParams = UpdateCommand.mock.calls[0][0];
    expect(updateParams.ExpressionAttributeValues[':completed']).toBe('completed');
    expect(updateParams.ExpressionAttributeValues[':s3Key']).toBe('backtests/user-1/bot-1/bt-1.json');

    // Verify EventBridge event
    const { PutEventsCommand } = jest.requireMock('@aws-sdk/client-eventbridge') as { PutEventsCommand: jest.Mock };
    expect(PutEventsCommand).toHaveBeenCalledTimes(1);
  });

  // ── rolling 5-result cap ─────────────────────────────────────────────────────

  /**
   * When there are more than 5 completed results, oldest should be deleted.
   */
  it('should enforce rolling 5-result cap by deleting oldest', async () => {
    mockS3Send.mockResolvedValue({});
    mockDdbSend.mockResolvedValueOnce({}); // Update to completed

    // Query returns 6 completed results (oldest first, ScanIndexForward=true)
    const existingResults = Array.from({ length: 6 }, (_, i) => ({
      sub: 'user-1',
      backtestId: `bt-${i}`,
      botId: 'bot-1',
      status: 'completed',
      s3Key: `backtests/user-1/bot-1/bt-${i}.json`,
      testedAt: `2024-01-0${i + 1}T00:00:00Z`,
    }));
    mockDdbSend.mockResolvedValueOnce({ Items: existingResults });

    // Delete S3 object for bt-0 (oldest)
    mockS3Send.mockResolvedValueOnce({});
    // Delete DynamoDB record for bt-0
    mockDdbSend.mockResolvedValueOnce({});

    // EventBridge
    mockEbSend.mockResolvedValueOnce({});

    await handler(buildSuccessInput());

    // One S3 delete for the oldest result
    const { DeleteObjectCommand } = jest.requireMock('@aws-sdk/client-s3') as { DeleteObjectCommand: jest.Mock };
    expect(DeleteObjectCommand).toHaveBeenCalledTimes(1);
    expect(DeleteObjectCommand.mock.calls[0][0].Key).toBe('backtests/user-1/bot-1/bt-0.json');

    // One DynamoDB delete for the oldest result
    const { DeleteCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { DeleteCommand: jest.Mock };
    expect(DeleteCommand).toHaveBeenCalledTimes(1);
    expect(DeleteCommand.mock.calls[0][0].Key.backtestId).toBe('bt-0');
  });

  /**
   * When there are 5 or fewer results, no deletions should occur.
   */
  it('should not delete when results are within the cap', async () => {
    mockS3Send.mockResolvedValueOnce({}); // S3 PutObject
    mockDdbSend.mockResolvedValueOnce({}); // Update to completed
    mockDdbSend.mockResolvedValueOnce({ Items: Array.from({ length: 5 }, (_, i) => ({
      sub: 'user-1',
      backtestId: `bt-${i}`,
      botId: 'bot-1',
      status: 'completed',
    })) });
    mockEbSend.mockResolvedValueOnce({});

    await handler(buildSuccessInput());

    const { DeleteCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { DeleteCommand: jest.Mock };
    expect(DeleteCommand).not.toHaveBeenCalled();
  });

  // ── EventBridge failure is best-effort ───────────────────────────────────────

  /**
   * If EventBridge publish fails, the handler should still succeed.
   */
  it('should succeed even when EventBridge publish fails', async () => {
    mockS3Send.mockResolvedValueOnce({});
    mockDdbSend.mockResolvedValueOnce({}); // Update
    mockDdbSend.mockResolvedValueOnce({ Items: [] }); // Cap check
    mockEbSend.mockRejectedValueOnce(new Error('EventBridge error'));

    const result = await handler(buildSuccessInput());
    expect(result.status).toBe('completed');
  });
});
