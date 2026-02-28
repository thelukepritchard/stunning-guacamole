// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockSend }) },
  PutCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Put' })),
}));

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('mock-uuid-1234'),
}));

import type { PostConfirmationConfirmSignUpTriggerEvent } from 'aws-lambda';
import { handler } from '../async/post-confirmation';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal Cognito PostConfirmationConfirmSignUpTriggerEvent.
 */
function buildPostConfirmationEvent(
  sub = 'user-sub-123',
  preferredUsername?: string,
): PostConfirmationConfirmSignUpTriggerEvent {
  return {
    version: '1',
    triggerSource: 'PostConfirmation_ConfirmSignUp',
    region: 'ap-southeast-2',
    userPoolId: 'ap-southeast-2_test',
    userName: sub,
    callerContext: {
      awsSdkVersion: '3.0.0',
      clientId: 'test-client-id',
    },
    request: {
      userAttributes: {
        sub,
        ...(preferredUsername !== undefined ? { preferred_username: preferredUsername } : {}),
      },
    },
    response: {},
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('post-confirmation handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    PutCommand.mockImplementation((params: object) => ({ ...params, _type: 'Put' }));

    process.env.PORTFOLIO_TABLE_NAME = 'portfolio-table';
    process.env.BOTS_TABLE_NAME = 'bots-table';
  });

  // ── missing preferred_username ───────────────────────────────────────────────

  /**
   * Should throw when preferred_username is missing from user attributes.
   */
  it('should throw when preferred_username is missing', async () => {
    const event = buildPostConfirmationEvent('user-1', undefined);
    delete (event.request.userAttributes as Record<string, string>)['preferred_username'];

    await expect(handler(event)).rejects.toThrow('preferred_username is required');
  });

  // ── successful flow ──────────────────────────────────────────────────────────

  /**
   * Should create a portfolio entry and a default bot for a new user.
   */
  it('should create portfolio entry and default bot', async () => {
    // Portfolio PutCommand succeeds
    mockSend.mockResolvedValueOnce({});
    // Default bot PutCommand succeeds
    mockSend.mockResolvedValueOnce({});

    const event = buildPostConfirmationEvent('user-1', 'test_user');
    const result = await handler(event);

    expect(result).toBe(event);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).toHaveBeenCalledTimes(2);

    // First call: portfolio entry
    const portfolioParams = PutCommand.mock.calls[0][0];
    expect(portfolioParams.TableName).toBe('portfolio-table');
    expect(portfolioParams.Item.sub).toBe('user-1');
    expect(portfolioParams.Item.username).toBe('test_user');
    expect(portfolioParams.ConditionExpression).toBe('attribute_not_exists(#sub)');

    // Second call: default bot
    const botParams = PutCommand.mock.calls[1][0];
    expect(botParams.TableName).toBe('bots-table');
    expect(botParams.Item.sub).toBe('user-1');
    expect(botParams.Item.name).toBe('RSI Dip Buyer');
    expect(botParams.Item.pair).toBe('BTC');
    expect(botParams.Item.status).toBe('draft');
    expect(botParams.Item.executionMode).toBe('once_and_wait');
  });

  // ── idempotency — ConditionalCheckFailedException ────────────────────────────

  /**
   * If portfolio entry already exists (ConditionalCheckFailedException),
   * handler should return the event without creating a default bot.
   */
  it('should skip bot creation when portfolio already exists', async () => {
    const err = Object.assign(new Error('Condition failed'), { name: 'ConditionalCheckFailedException' });
    mockSend.mockRejectedValueOnce(err);

    const event = buildPostConfirmationEvent('user-1', 'existing_user');
    const result = await handler(event);

    expect(result).toBe(event);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    // Only one PutCommand (the portfolio write attempt) — no bot creation
    expect(PutCommand).toHaveBeenCalledTimes(1);
  });

  // ── portfolio write throws non-conditional error ─────────────────────────────

  /**
   * Non-conditional errors from the portfolio write should propagate.
   */
  it('should throw when portfolio write fails with a non-conditional error', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB throttled'));

    const event = buildPostConfirmationEvent('user-1', 'test_user');
    await expect(handler(event)).rejects.toThrow('DynamoDB throttled');
  });

  // ── default bot creation failure is best-effort ──────────────────────────────

  /**
   * If default bot creation fails, the handler should still return
   * successfully (best-effort — signup should not be blocked).
   */
  it('should succeed even when default bot creation fails', async () => {
    // Portfolio write succeeds
    mockSend.mockResolvedValueOnce({});
    // Bot write fails
    mockSend.mockRejectedValueOnce(new Error('Bot table write error'));

    const event = buildPostConfirmationEvent('user-1', 'test_user');
    const result = await handler(event);

    expect(result).toBe(event);
  });
});
