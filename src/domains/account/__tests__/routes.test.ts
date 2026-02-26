import { buildEvent } from '../../test-utils';

// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockDdbSend = jest.fn();
const mockS3Send = jest.fn();
const mockCognitoSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockDdbSend }) },
  PutCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteCommand: jest.fn().mockImplementation((input) => ({ input })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ input })),
  BatchWriteCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  ListObjectsV2Command: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectsCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
  AdminDisableUserCommand: jest.fn().mockImplementation((input) => ({ input })),
  AdminDeleteUserCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { submitFeedback } from '../routes/submit-feedback';
import { deleteAccount } from '../routes/delete-account';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a minimal authenticated event stub.
 */
function authedEvent(overrides = {}) {
  return buildEvent({
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          email: 'test@example.com',
          'cognito:username': 'testuser',
        },
      },
    } as never,
    ...overrides,
  });
}

// ─── submitFeedback ───────────────────────────────────────────────────────────

describe('submitFeedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FEEDBACK_TABLE_NAME = 'feedback';
    mockDdbSend.mockResolvedValue({});
  });

  /**
   * Should return 201 with created feedback item on success.
   */
  it('should return 201 with created feedback item', async () => {
    const result = await submitFeedback(authedEvent({
      body: JSON.stringify({ category: 'bug', message: 'Something is broken' }),
    }));
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.category).toBe('bug');
    expect(body.message).toBe('Something is broken');
    expect(body.email).toBe('test@example.com');
    expect(body.id).toBeDefined();
  });

  /**
   * Should use default category 'general' when not provided.
   */
  it('should default category to general when omitted', async () => {
    const result = await submitFeedback(authedEvent({
      body: JSON.stringify({ message: 'Hello' }),
    }));
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.category).toBe('general');
  });

  /**
   * Should default message to empty string when not provided.
   */
  it('should default message to empty string when omitted', async () => {
    const result = await submitFeedback(authedEvent({ body: JSON.stringify({}) }));
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).message).toBe('');
  });

  /**
   * Should use 'unknown' as email when not present in claims.
   */
  it('should use unknown as email when claims are absent', async () => {
    const result = await submitFeedback(buildEvent({
      body: JSON.stringify({ message: 'Test' }),
    }));
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).email).toBe('unknown');
  });
});

// ─── deleteAccount ────────────────────────────────────────────────────────────

describe('deleteAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PORTFOLIO_TABLE_NAME = 'portfolio';
    process.env.TRADING_SETTINGS_TABLE_NAME = 'settings';
    process.env.DEMO_BALANCES_TABLE_NAME = 'demo-balances';
    process.env.PORTFOLIO_PERFORMANCE_TABLE_NAME = 'portfolio-performance';
    process.env.TRADING_BOTS_TABLE_NAME = 'bots';
    process.env.TRADING_BACKTESTS_TABLE_NAME = 'backtests';
    process.env.DEMO_ORDERS_TABLE_NAME = 'demo-orders';
    process.env.TRADING_TRADES_TABLE_NAME = 'trades';
    process.env.TRADING_BOT_PERFORMANCE_TABLE_NAME = 'bot-performance';
    process.env.BACKTEST_REPORTS_BUCKET_NAME = 'backtest-reports';
    process.env.USER_POOL_ID = 'us-east-1_test';
  });

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await deleteAccount(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when cognito username is not resolvable.
   */
  it('should return 400 when cognito username is missing', async () => {
    const result = await deleteAccount(buildEvent({
      requestContext: {
        authorizer: { claims: { sub: 'user-123' } },
      } as never,
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('username');
  });

  /**
   * Should return 200 on successful account deletion.
   */
  it('should return 200 on successful account deletion', async () => {
    // DynamoDB: single deletes (portfolio, settings, demo-balances)
    // + composite deletes (query then batch delete: portfolio-perf, bots, backtests, demo-orders)
    // + GSI deletes (trades, bot-performance)
    // All return empty results to short-circuit pagination
    mockDdbSend.mockResolvedValue({ Items: [], UnprocessedItems: {} });
    mockS3Send.mockResolvedValue({ Contents: [], NextContinuationToken: undefined });
    mockCognitoSend.mockResolvedValue({});

    const result = await deleteAccount(authedEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ message: 'Account deleted successfully' });
  });

  /**
   * Should still succeed if Cognito disable fails before user deletion.
   */
  it('should proceed past Cognito disable errors and delete user', async () => {
    mockDdbSend.mockResolvedValue({ Items: [], UnprocessedItems: {} });
    mockS3Send.mockResolvedValue({ Contents: [], NextContinuationToken: undefined });
    mockCognitoSend
      .mockRejectedValueOnce(new Error('User already disabled')) // AdminDisableUser
      .mockResolvedValueOnce({}); // AdminDeleteUser
    const result = await deleteAccount(authedEvent());
    expect(result.statusCode).toBe(200);
  });
});
