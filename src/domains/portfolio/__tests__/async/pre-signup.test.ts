import type { PreSignUpTriggerEvent } from 'aws-lambda';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
}));

import { handler } from '../../async/pre-signup';

/**
 * Builds a minimal mock Cognito PreSignUp_SignUp trigger event.
 *
 * @param userAttributes - The user attributes to include in the event.
 * @returns A mock PreSignUpTriggerEvent.
 */
function buildEvent(
  userAttributes: Record<string, string>,
): PreSignUpTriggerEvent {
  return {
    version: '1',
    region: 'ap-southeast-2',
    userPoolId: 'ap-southeast-2_TestPool',
    userName: 'testuser',
    triggerSource: 'PreSignUp_SignUp',
    callerContext: {
      awsSdkVersion: 'aws-sdk-js-2.x',
      clientId: 'test-client-id',
    },
    request: {
      userAttributes,
      validationData: {},
      clientMetadata: {},
    },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
  } as PreSignUpTriggerEvent;
}

/**
 * Tests for the portfolio pre-sign-up Cognito trigger.
 * Covers username validation (presence, length, character set) and
 * the uniqueness check against the portfolio table's username-index GSI.
 */
describe('pre-signup handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PORTFOLIO_TABLE_NAME = 'PortfolioTable';
  });

  // ─── Happy path ───────────────────────────────────────────────────────────

  /**
   * Valid username that passes all checks and is not already taken.
   */
  it('returns the event when the username is valid and not taken', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent({ preferred_username: 'alice_99' });

    const result = await handler(event);

    expect(result).toBe(event);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  /**
   * Verifies the GSI query is issued with the correct parameters.
   */
  it('queries the username-index GSI with the provided username', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent({ preferred_username: 'validuser' });
    await handler(event);

    const queryCall = (mockSend.mock.calls[0][0] as {
      TableName: string;
      IndexName: string;
      ExpressionAttributeValues: Record<string, unknown>;
    });
    expect(queryCall.TableName).toBe('PortfolioTable');
    expect(queryCall.IndexName).toBe('username-index');
    expect(queryCall.ExpressionAttributeValues[':username']).toBe('validuser');
  });

  /**
   * Minimum-length boundary: a 3-character username should be accepted.
   */
  it('accepts a username exactly at the minimum length (3 characters)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent({ preferred_username: 'abc' });

    await expect(handler(event)).resolves.toBe(event);
  });

  /**
   * Maximum-length boundary: a 20-character username should be accepted.
   */
  it('accepts a username exactly at the maximum length (20 characters)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent({ preferred_username: 'a'.repeat(20) });

    await expect(handler(event)).resolves.toBeDefined();
  });

  // ─── Validation failures ──────────────────────────────────────────────────

  /**
   * Missing username — preferred_username attribute not present.
   */
  it('throws when preferred_username is missing', async () => {
    const event = buildEvent({});

    await expect(handler(event)).rejects.toThrow('Username is required');
    expect(mockSend).not.toHaveBeenCalled();
  });

  /**
   * Username too short — 2 characters, below the 3-character minimum.
   */
  it('throws when username is too short (2 characters)', async () => {
    const event = buildEvent({ preferred_username: 'ab' });

    await expect(handler(event)).rejects.toThrow(
      'Username must be between 3 and 20 characters',
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  /**
   * Username too long — 21 characters, above the 20-character maximum.
   */
  it('throws when username is too long (21 characters)', async () => {
    const event = buildEvent({ preferred_username: 'a'.repeat(21) });

    await expect(handler(event)).rejects.toThrow(
      'Username must be between 3 and 20 characters',
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  /**
   * Disallowed characters — hyphen is not in the allowed set.
   */
  it('throws when username contains a hyphen', async () => {
    const event = buildEvent({ preferred_username: 'bad-username' });

    await expect(handler(event)).rejects.toThrow(
      'Username can only contain letters, numbers, and underscores',
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  /**
   * Disallowed characters — space is not in the allowed set.
   */
  it('throws when username contains a space', async () => {
    const event = buildEvent({ preferred_username: 'bad username' });

    await expect(handler(event)).rejects.toThrow(
      'Username can only contain letters, numbers, and underscores',
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  /**
   * Disallowed characters — special characters (@, .) are rejected.
   */
  it('throws when username contains special characters', async () => {
    const event = buildEvent({ preferred_username: 'user@name' });

    await expect(handler(event)).rejects.toThrow(
      'Username can only contain letters, numbers, and underscores',
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  // ─── Uniqueness check ─────────────────────────────────────────────────────

  /**
   * Username already taken — GSI returns an existing item.
   */
  it('throws when the username is already taken', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ sub: 'existing-user', username: 'alice' }],
    });

    const event = buildEvent({ preferred_username: 'alice' });

    await expect(handler(event)).rejects.toThrow('Username is already taken');
  });

  /**
   * Username not taken — GSI returns an empty Items array.
   */
  it('does not throw when Items is an empty array', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent({ preferred_username: 'newuser' });

    await expect(handler(event)).resolves.toBe(event);
  });

  /**
   * Username not taken — GSI returns undefined Items (no matches).
   */
  it('does not throw when Items is undefined', async () => {
    mockSend.mockResolvedValueOnce({ Items: undefined });

    const event = buildEvent({ preferred_username: 'newuser' });

    await expect(handler(event)).resolves.toBe(event);
  });

  // ─── Allowed character set ────────────────────────────────────────────────

  /**
   * Uppercase letters are allowed.
   */
  it('accepts a username with uppercase letters', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent({ preferred_username: 'Alice99' });

    await expect(handler(event)).resolves.toBe(event);
  });

  /**
   * Underscores are allowed.
   */
  it('accepts a username with underscores', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent({ preferred_username: 'user_name' });

    await expect(handler(event)).resolves.toBe(event);
  });

  /**
   * Digits are allowed.
   */
  it('accepts a username that is entirely numeric', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent({ preferred_username: '12345' });

    await expect(handler(event)).resolves.toBe(event);
  });
});
