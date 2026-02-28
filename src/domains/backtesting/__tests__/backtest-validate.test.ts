// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockSend }) },
  GetCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Get' })),
  QueryCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Query' })),
  UpdateCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Update' })),
}));

import type { BotRecord } from '../../shared/types';
import { handler } from '../async/backtest-validate';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal BotRecord.
 */
function buildBot(overrides: Partial<BotRecord> = {}): BotRecord {
  return {
    sub: 'user-1',
    botId: 'bot-1',
    name: 'Test Bot',
    pair: 'BTC',
    status: 'active',
    executionMode: 'once_and_wait',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Standard validate input. */
function buildValidateInput() {
  return {
    backtestId: 'bt-1',
    sub: 'user-1',
    botId: 'bot-1',
    botConfigSnapshot: buildBot(),
    windowStart: '2024-01-01T00:00:00Z',
    windowEnd: '2024-01-31T00:00:00Z',
    waitSeconds: 0,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('backtest-validate handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const { GetCommand, QueryCommand, UpdateCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as {
      GetCommand: jest.Mock;
      QueryCommand: jest.Mock;
      UpdateCommand: jest.Mock;
    };
    GetCommand.mockImplementation((params: object) => ({ ...params, _type: 'Get' }));
    QueryCommand.mockImplementation((params: object) => ({ ...params, _type: 'Query' }));
    UpdateCommand.mockImplementation((params: object) => ({ ...params, _type: 'Update' }));

    process.env.BOTS_TABLE_NAME = 'bots-table';
    process.env.BACKTESTS_TABLE_NAME = 'backtests-table';
  });

  // ── bot not found ────────────────────────────────────────────────────────────

  /**
   * Should throw when the bot does not exist.
   */
  it('should throw when bot is not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    await expect(handler(buildValidateInput())).rejects.toThrow('Bot not found');
  });

  // ── concurrent backtest ──────────────────────────────────────────────────────

  /**
   * Should throw when another backtest is already pending or running for this bot.
   */
  it('should throw when another backtest is in progress', async () => {
    // Bot exists
    mockSend.mockResolvedValueOnce({ Item: buildBot() });
    // Inflight query returns another running backtest
    mockSend.mockResolvedValueOnce({
      Items: [{ backtestId: 'bt-other', botId: 'bot-1', status: 'running' }],
    });

    await expect(handler(buildValidateInput())).rejects.toThrow(
      'Another backtest is already in progress',
    );
  });

  // ── successful validation ────────────────────────────────────────────────────

  /**
   * Should update status to running and return the validated context.
   */
  it('should update status to running and return input on success', async () => {
    // Bot exists
    mockSend.mockResolvedValueOnce({ Item: buildBot() });
    // No inflight backtests
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Status update succeeds
    mockSend.mockResolvedValueOnce({});

    const input = buildValidateInput();
    const result = await handler(input);

    expect(result.backtestId).toBe('bt-1');
    expect(result.sub).toBe('user-1');
    expect(result.botId).toBe('bot-1');
    expect(result.windowStart).toBe('2024-01-01T00:00:00Z');
    expect(result.windowEnd).toBe('2024-01-31T00:00:00Z');

    // Verify update command set status to running
    const { UpdateCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { UpdateCommand: jest.Mock };
    expect(UpdateCommand).toHaveBeenCalledTimes(1);
    const updateParams = UpdateCommand.mock.calls[0][0];
    expect(updateParams.Key).toEqual({ sub: 'user-1', backtestId: 'bt-1' });
    expect(updateParams.ExpressionAttributeValues[':running']).toBe('running');
  });

  /**
   * Should allow when no other in-progress backtests exist (empty Items).
   */
  it('should proceed when no inflight backtests exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: buildBot() });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});

    await expect(handler(buildValidateInput())).resolves.toBeDefined();
  });

  /**
   * Should allow when the only inflight backtest is the current one
   * (filtered out by backtestId <> :backtestId).
   */
  it('should allow when the only inflight backtest is the current one', async () => {
    mockSend.mockResolvedValueOnce({ Item: buildBot() });
    // The query already excludes the current backtestId, so Items should be empty
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});

    await expect(handler(buildValidateInput())).resolves.toBeDefined();
  });
});
