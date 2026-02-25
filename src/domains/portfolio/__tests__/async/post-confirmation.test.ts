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
 */
describe('post-confirmation handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PORTFOLIO_TABLE_NAME = 'PortfolioTable';
  });

  /**
   * Happy path — new user confirmed; portfolio entry is created successfully.
   */
  it('creates a portfolio entry and returns the event on success', async () => {
    mockSend.mockResolvedValueOnce({});

    const event = buildEvent({
      sub: 'user-abc-123',
      preferred_username: 'alice',
      email: 'alice@example.com',
    });

    const result = await handler(event);

    expect(result).toBe(event);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const putCall = (mockSend.mock.calls[0][0] as { TableName: string; Item: Record<string, unknown> });
    expect(putCall.TableName).toBe('PortfolioTable');
    expect(putCall.Item.sub).toBe('user-abc-123');
    expect(putCall.Item.username).toBe('alice');
    expect(typeof putCall.Item.createdAt).toBe('string');
  });

  /**
   * Idempotency — when ConditionalCheckFailedException is thrown, the error is
   * swallowed and the event is still returned (safe to re-trigger).
   */
  it('returns the event without throwing when a portfolio already exists', async () => {
    const alreadyExistsErr = Object.assign(new Error('ConditionalCheckFailedException'), {
      name: 'ConditionalCheckFailedException',
    });
    mockSend.mockRejectedValueOnce(alreadyExistsErr);

    const event = buildEvent({ sub: 'user-abc-123', preferred_username: 'alice' });

    await expect(handler(event)).resolves.toBe(event);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  /**
   * Error propagation — unrecognised DynamoDB errors must bubble up so
   * Cognito knows the trigger failed and can surface it to the caller.
   */
  it('re-throws unexpected DynamoDB errors', async () => {
    const unexpectedErr = Object.assign(new Error('ResourceNotFoundException'), {
      name: 'ResourceNotFoundException',
    });
    mockSend.mockRejectedValueOnce(unexpectedErr);

    const event = buildEvent({ sub: 'user-abc-123', preferred_username: 'alice' });

    await expect(handler(event)).rejects.toThrow('ResourceNotFoundException');
  });

  /**
   * Missing preferred_username — the handler throws immediately so that
   * Cognito surfaces the failure rather than creating a record with no username.
   */
  it('throws when preferred_username is absent', async () => {
    const event = buildEvent({ sub: 'user-abc-123' });

    await expect(handler(event)).rejects.toThrow('preferred_username is required on post-confirmation');
    expect(mockSend).not.toHaveBeenCalled();
  });

  /**
   * Verifies the conditional write expression is set to protect idempotency.
   */
  it('passes a conditional write expression to DynamoDB', async () => {
    mockSend.mockResolvedValueOnce({});

    const event = buildEvent({ sub: 'user-xyz', preferred_username: 'bob' });
    await handler(event);

    const putCall = (mockSend.mock.calls[0][0] as {
      ConditionExpression: string;
      ExpressionAttributeNames: Record<string, string>;
    });
    expect(putCall.ConditionExpression).toBe('attribute_not_exists(#sub)');
    expect(putCall.ExpressionAttributeNames['#sub']).toBe('sub');
  });
});
