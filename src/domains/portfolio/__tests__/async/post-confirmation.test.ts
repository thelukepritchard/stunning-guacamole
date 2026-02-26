import type { PostConfirmationConfirmSignUpTriggerEvent } from 'aws-lambda';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  PutCommand: jest.fn((params) => ({ ...params, _type: 'Put' })),
}));

import { handler } from '../../async/post-confirmation';

// Grab the mocked PutCommand constructor so we can inspect what params were passed.
const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as {
  PutCommand: jest.Mock;
};

/**
 * Builds a minimal mock Cognito PostConfirmation_ConfirmSignUp trigger event.
 *
 * @param userAttributes - The user attributes to include in the event.
 * @returns A mock PostConfirmationConfirmSignUpTriggerEvent.
 */
function buildEvent(
  userAttributes: Record<string, string>,
): PostConfirmationConfirmSignUpTriggerEvent {
  return {
    version: '1',
    region: 'ap-southeast-2',
    userPoolId: 'ap-southeast-2_TestPool',
    userName: 'testuser',
    triggerSource: 'PostConfirmation_ConfirmSignUp',
    callerContext: {
      awsSdkVersion: 'aws-sdk-js-2.x',
      clientId: 'test-client-id',
    },
    request: { userAttributes },
    response: {},
  } as PostConfirmationConfirmSignUpTriggerEvent;
}

/**
 * Tests for the portfolio post-confirmation Cognito trigger.
 * Verifies that a PortfolioRecord is created in DynamoDB on user confirmation,
 * using the preferred_username attribute and idempotency conditional write.
 * Also verifies that a default "RSI Dip Buyer" bot is created in the bots table
 * as a best-effort operation after the portfolio write succeeds.
 */
describe('post-confirmation handler', () => {
  beforeEach(() => {
    // Use resetAllMocks to clear both call history and the mockResolvedValueOnce
    // queue — prevents leftover queued values from bleeding into subsequent tests.
    // NOTE: After resetAllMocks the PutCommand implementation is cleared, so
    // introspect PutCommand.mock.calls[N][0] (constructor params) rather than
    // mockSend.mock.calls[N][0] (the constructed instance, which becomes {}).
    jest.resetAllMocks();
    process.env.PORTFOLIO_TABLE_NAME = 'PortfolioTable';
    process.env.BOTS_TABLE_NAME = 'BotsTable';
  });

  /**
   * Happy path — new user confirmed; portfolio entry and default bot are created.
   * The handler makes exactly 2 DDB sends: one for the portfolio, one for the bot.
   */
  it('creates a portfolio entry and a default bot, then returns the event on success', async () => {
    mockSend.mockResolvedValueOnce({}); // portfolio PutCommand
    mockSend.mockResolvedValueOnce({}); // bot PutCommand

    const event = buildEvent({
      sub: 'user-abc-123',
      preferred_username: 'alice',
      email: 'alice@example.com',
    });

    const result = await handler(event);

    expect(result).toBe(event);
    expect(mockSend).toHaveBeenCalledTimes(2);

    // Inspect the constructor params (not the constructed instance) because
    // jest.resetAllMocks() clears the implementation so the instance is {}.
    const portfolioParams = PutCommand.mock.calls[0][0] as {
      TableName: string;
      Item: Record<string, unknown>;
    };
    expect(portfolioParams.TableName).toBe('PortfolioTable');
    expect(portfolioParams.Item.sub).toBe('user-abc-123');
    expect(portfolioParams.Item.username).toBe('alice');
    expect(typeof portfolioParams.Item.createdAt).toBe('string');
  });

  /**
   * Idempotency — when ConditionalCheckFailedException is thrown the portfolio
   * already exists. The handler returns early WITHOUT creating a default bot.
   */
  it('returns the event without throwing when a portfolio already exists and skips bot creation', async () => {
    const alreadyExistsErr = Object.assign(new Error('ConditionalCheckFailedException'), {
      name: 'ConditionalCheckFailedException',
    });
    mockSend.mockRejectedValueOnce(alreadyExistsErr);

    const event = buildEvent({ sub: 'user-abc-123', preferred_username: 'alice' });

    await expect(handler(event)).resolves.toBe(event);
    // Only the portfolio PutCommand should have been attempted — no bot write.
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(PutCommand).toHaveBeenCalledTimes(1);
  });

  /**
   * Error propagation — unrecognised DynamoDB errors must bubble up so
   * Cognito knows the trigger failed and can surface it to the caller.
   * No bot creation should be attempted when the portfolio write fails.
   */
  it('re-throws unexpected DynamoDB errors and does not create a bot', async () => {
    const unexpectedErr = Object.assign(new Error('ResourceNotFoundException'), {
      name: 'ResourceNotFoundException',
    });
    mockSend.mockRejectedValueOnce(unexpectedErr);

    const event = buildEvent({ sub: 'user-abc-123', preferred_username: 'alice' });

    await expect(handler(event)).rejects.toThrow('ResourceNotFoundException');
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(PutCommand).toHaveBeenCalledTimes(1);
  });

  /**
   * Missing preferred_username — the handler throws immediately so that
   * Cognito surfaces the failure rather than creating a record with no username.
   * No DDB calls should be made at all.
   */
  it('throws when preferred_username is absent', async () => {
    const event = buildEvent({ sub: 'user-abc-123' });

    await expect(handler(event)).rejects.toThrow('preferred_username is required on post-confirmation');
    expect(mockSend).not.toHaveBeenCalled();
    expect(PutCommand).not.toHaveBeenCalled();
  });

  /**
   * Verifies the conditional write expression is set on the portfolio PutCommand
   * to protect idempotency (duplicate triggers won't overwrite).
   */
  it('passes a conditional write expression to the portfolio DynamoDB PutCommand', async () => {
    mockSend.mockResolvedValueOnce({}); // portfolio PutCommand
    mockSend.mockResolvedValueOnce({}); // bot PutCommand

    const event = buildEvent({ sub: 'user-xyz', preferred_username: 'bob' });
    await handler(event);

    const portfolioParams = PutCommand.mock.calls[0][0] as {
      ConditionExpression: string;
      ExpressionAttributeNames: Record<string, string>;
    };
    expect(portfolioParams.ConditionExpression).toBe('attribute_not_exists(#sub)');
    expect(portfolioParams.ExpressionAttributeNames['#sub']).toBe('sub');
  });

  /**
   * Default bot structure — verifies that the second DDB PutCommand targets
   * the bots table and contains the expected "RSI Dip Buyer" bot fields.
   */
  it('writes the default RSI Dip Buyer bot to the bots table', async () => {
    mockSend.mockResolvedValueOnce({}); // portfolio PutCommand
    mockSend.mockResolvedValueOnce({}); // bot PutCommand

    const event = buildEvent({ sub: 'user-bot-test', preferred_username: 'carol' });
    await handler(event);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(PutCommand).toHaveBeenCalledTimes(2);

    const botParams = PutCommand.mock.calls[1][0] as {
      TableName: string;
      Item: Record<string, unknown>;
    };
    expect(botParams.TableName).toBe('BotsTable');
    expect(botParams.Item.sub).toBe('user-bot-test');
    expect(botParams.Item.name).toBe('RSI Dip Buyer');
    expect(botParams.Item.pair).toBe('BTCUSDT');
    expect(botParams.Item.status).toBe('draft');
    expect(botParams.Item.executionMode).toBe('once_and_wait');
    expect(typeof botParams.Item.botId).toBe('string');
    expect(typeof botParams.Item.createdAt).toBe('string');
    expect(typeof botParams.Item.updatedAt).toBe('string');
  });

  /**
   * Bot buy/sell query structure — verifies that the default bot's RSI rules
   * are written with the correct combinator, field, operator, and value.
   */
  it('writes the default bot with correct RSI buy and sell query rules', async () => {
    mockSend.mockResolvedValueOnce({}); // portfolio PutCommand
    mockSend.mockResolvedValueOnce({}); // bot PutCommand

    const event = buildEvent({ sub: 'user-rules-test', preferred_username: 'dave' });
    await handler(event);

    const botParams = PutCommand.mock.calls[1][0] as {
      Item: {
        buyQuery: { combinator: string; rules: Array<{ field: string; operator: string; value: string }> };
        sellQuery: { combinator: string; rules: Array<{ field: string; operator: string; value: string }> };
        buySizing: { type: string; value: number };
        sellSizing: { type: string; value: number };
      };
    };

    expect(botParams.Item.buyQuery).toEqual({
      combinator: 'and',
      rules: [{ field: 'rsi_7', operator: '<', value: '40' }],
    });
    expect(botParams.Item.sellQuery).toEqual({
      combinator: 'and',
      rules: [{ field: 'rsi_7', operator: '>', value: '60' }],
    });
    expect(botParams.Item.buySizing).toEqual({ type: 'percentage', value: 10 });
    expect(botParams.Item.sellSizing).toEqual({ type: 'percentage', value: 100 });
  });

  /**
   * Best-effort bot creation — if the bot PutCommand throws, the handler logs
   * the error but still returns the event so that Cognito confirms the user.
   * The portfolio write must have succeeded for this path to be reached.
   */
  it('still returns the event when bot creation fails (best-effort)', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockSend.mockResolvedValueOnce({});            // portfolio PutCommand — succeeds
    mockSend.mockRejectedValueOnce(new Error('BotsTable does not exist')); // bot PutCommand — fails

    const event = buildEvent({ sub: 'user-bot-fail', preferred_username: 'eve' });

    const result = await handler(event);

    expect(result).toBe(event);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to create default bot — signup continues:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  /**
   * Bot botId uniqueness — each invocation should generate a distinct UUID
   * so that concurrent confirmations produce separate bot records.
   */
  it('generates a unique botId for every invocation', async () => {
    mockSend.mockResolvedValue({}); // accept any number of sends

    const event1 = buildEvent({ sub: 'user-1', preferred_username: 'frank' });
    const event2 = buildEvent({ sub: 'user-2', preferred_username: 'grace' });

    await handler(event1);
    await handler(event2);

    // Call indices: 0=portfolio for user-1, 1=bot for user-1, 2=portfolio for user-2, 3=bot for user-2
    const botId1 = (PutCommand.mock.calls[1][0] as { Item: { botId: string } }).Item.botId;
    const botId2 = (PutCommand.mock.calls[3][0] as { Item: { botId: string } }).Item.botId;

    expect(botId1).not.toBe(botId2);
    expect(botId1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(botId2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
