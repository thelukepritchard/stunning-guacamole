// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockSend }) },
  QueryCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Query' })),
}));

import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { handler } from '../async/pre-signup';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal Cognito PreSignUpTriggerEvent with a given preferred_username.
 */
function buildPreSignUpEvent(preferredUsername?: string): PreSignUpTriggerEvent {
  return {
    version: '1',
    triggerSource: 'PreSignUp_SignUp',
    region: 'ap-southeast-2',
    userPoolId: 'ap-southeast-2_test',
    userName: 'test-cognito-user-id',
    callerContext: {
      awsSdkVersion: '3.0.0',
      clientId: 'test-client-id',
    },
    request: {
      userAttributes: {
        ...(preferredUsername !== undefined ? { preferred_username: preferredUsername } : {}),
      },
      validationData: {},
    },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('pre-signup handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    QueryCommand.mockImplementation((params: object) => ({ ...params, _type: 'Query' }));

    process.env.PORTFOLIO_TABLE_NAME = 'portfolio-table';
  });

  // ── missing username ─────────────────────────────────────────────────────────

  /**
   * Should throw when preferred_username is missing from user attributes.
   */
  it('should throw when preferred_username is missing', async () => {
    const event = buildPreSignUpEvent(undefined);
    // Remove the key entirely
    delete (event.request.userAttributes as Record<string, string>)['preferred_username'];

    await expect(handler(event)).rejects.toThrow('Username is required');
  });

  // ── too short ────────────────────────────────────────────────────────────────

  /**
   * Should throw when username is shorter than 3 characters.
   */
  it('should throw when username is too short', async () => {
    await expect(handler(buildPreSignUpEvent('ab'))).rejects.toThrow(
      'Username must be between 3 and 20 characters',
    );
  });

  // ── too long ─────────────────────────────────────────────────────────────────

  /**
   * Should throw when username is longer than 20 characters.
   */
  it('should throw when username is too long', async () => {
    const longUsername = 'a'.repeat(21);
    await expect(handler(buildPreSignUpEvent(longUsername))).rejects.toThrow(
      'Username must be between 3 and 20 characters',
    );
  });

  // ── invalid characters ───────────────────────────────────────────────────────

  /**
   * Should throw when username contains invalid characters.
   */
  it('should throw when username contains spaces', async () => {
    await expect(handler(buildPreSignUpEvent('bad user'))).rejects.toThrow(
      'Username can only contain letters, numbers, and underscores',
    );
  });

  it('should throw when username contains special characters', async () => {
    await expect(handler(buildPreSignUpEvent('user@name'))).rejects.toThrow(
      'Username can only contain letters, numbers, and underscores',
    );
  });

  it('should throw when username contains dashes', async () => {
    await expect(handler(buildPreSignUpEvent('user-name'))).rejects.toThrow(
      'Username can only contain letters, numbers, and underscores',
    );
  });

  // ── username already taken ───────────────────────────────────────────────────

  /**
   * Should throw when the username already exists in the portfolio table.
   */
  it('should throw when username is already taken', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ sub: 'existing-user' }] });

    await expect(handler(buildPreSignUpEvent('taken_name'))).rejects.toThrow(
      'Username is already taken',
    );

    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    expect(QueryCommand).toHaveBeenCalledTimes(1);
    const queryParams = QueryCommand.mock.calls[0][0];
    expect(queryParams.IndexName).toBe('username-index');
    expect(queryParams.ExpressionAttributeValues[':username']).toBe('taken_name');
  });

  // ── valid username ───────────────────────────────────────────────────────────

  /**
   * Should return the event when username is valid and not taken.
   */
  it('should return the event for a valid unique username', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildPreSignUpEvent('valid_user_123');
    const result = await handler(event);

    expect(result).toBe(event);
  });

  /**
   * Should accept minimum-length username (3 characters).
   */
  it('should accept a 3-character username', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildPreSignUpEvent('abc');
    const result = await handler(event);
    expect(result).toBe(event);
  });

  /**
   * Should accept maximum-length username (20 characters).
   */
  it('should accept a 20-character username', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildPreSignUpEvent('a'.repeat(20));
    const result = await handler(event);
    expect(result).toBe(event);
  });

  /**
   * Should accept username with underscores.
   */
  it('should accept username with underscores', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildPreSignUpEvent('my_user_name');
    const result = await handler(event);
    expect(result).toBe(event);
  });
});
