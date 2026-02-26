import type { APIGatewayProxyEvent } from 'aws-lambda';
import { buildEvent } from '../../test-utils';

// ─── Mock senders ────────────────────────────────────────────────────────────

const mockDdbSend = jest.fn();
const mockS3Send = jest.fn();
const mockCognitoSend = jest.fn();

// ─── AWS SDK mocks (must precede imports) ────────────────────────────────────

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDdbSend })) },
  PutCommand: jest.fn((params) => ({ ...params, _type: 'Put' })),
  DeleteCommand: jest.fn((params) => ({ ...params, _type: 'Delete' })),
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
  BatchWriteCommand: jest.fn((params) => ({ ...params, _type: 'BatchWrite' })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  ListObjectsV2Command: jest.fn((params) => ({ ...params, _type: 'ListObjectsV2' })),
  DeleteObjectsCommand: jest.fn((params) => ({ ...params, _type: 'DeleteObjects' })),
}));

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockCognitoSend })),
  AdminDisableUserCommand: jest.fn((params) => ({ ...params, _type: 'AdminDisableUser' })),
  AdminDeleteUserCommand: jest.fn((params) => ({ ...params, _type: 'AdminDeleteUser' })),
}));

import { submitFeedback } from '../routes/submit-feedback';
import { deleteAccount } from '../routes/delete-account';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a mock API Gateway event with Cognito claims for route handler tests.
 *
 * @param overrides - Partial event properties merged into the defaults.
 * @returns A fully-formed mock API Gateway proxy event.
 */
function buildAuthEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return buildEvent({
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-sub-123',
          'cognito:username': 'testuser',
        },
      },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  });
}

// ─── submitFeedback tests ─────────────────────────────────────────────────────

/**
 * Tests for the submitFeedback route handler.
 */
describe('submitFeedback', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.FEEDBACK_TABLE_NAME = 'Feedback-test';

    // Restore command constructor implementations cleared by resetAllMocks.
    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    PutCommand.mockImplementation((params: unknown) => ({ ...(params as object), _type: 'Put' }));
  });

  /** Verifies a valid request returns 201 with the created item. */
  it('returns 201 with the created feedback item', async () => {
    mockDdbSend.mockResolvedValueOnce({});

    const result = await submitFeedback(buildEvent({
      httpMethod: 'POST',
      resource: '/core/feedback',
      body: JSON.stringify({ category: 'bug', message: 'Something is broken' }),
      requestContext: {
        authorizer: { claims: { email: 'user@example.com' } },
      } as any,
    }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body).toEqual(expect.objectContaining({
      email: 'user@example.com',
      category: 'bug',
      message: 'Something is broken',
    }));
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();
  });

  /** Verifies the feedback item is written to DynamoDB with correct attributes. */
  it('writes the item to DynamoDB', async () => {
    mockDdbSend.mockResolvedValueOnce({});

    await submitFeedback(buildEvent({
      httpMethod: 'POST',
      resource: '/core/feedback',
      body: JSON.stringify({ category: 'feature', message: 'Add dark mode' }),
      requestContext: {
        authorizer: { claims: { email: 'test@example.com' } },
      } as any,
    }));

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
    expect(PutCommand.mock.calls[0][0]).toEqual(expect.objectContaining({
      TableName: 'Feedback-test',
      Item: expect.objectContaining({
        email: 'test@example.com',
        category: 'feature',
        message: 'Add dark mode',
      }),
    }));
  });

  /** Verifies that category defaults to "general" when omitted. */
  it('defaults category to general when not provided', async () => {
    mockDdbSend.mockResolvedValueOnce({});

    const result = await submitFeedback(buildEvent({
      httpMethod: 'POST',
      resource: '/core/feedback',
      body: JSON.stringify({ message: 'Hello' }),
      requestContext: {
        authorizer: { claims: { email: 'user@example.com' } },
      } as any,
    }));
    const body = JSON.parse(result.body);

    expect(body.category).toBe('general');
  });
});

// ─── deleteAccount tests ──────────────────────────────────────────────────────

/**
 * Tests for the deleteAccount route handler.
 * Verifies DynamoDB, S3, and Cognito cleanup across all tables and the
 * backtest-reports bucket, plus authorization and error-path behaviour.
 */
describe('deleteAccount', () => {
  beforeEach(() => {
    jest.resetAllMocks();

    // After resetAllMocks(), command constructors lose their implementations and return
    // undefined. Restore them so mockDdbSend / mockCognitoSend receive inspectable objects.
    const libDdb = jest.requireMock('@aws-sdk/lib-dynamodb') as {
      PutCommand: jest.Mock;
      DeleteCommand: jest.Mock;
      QueryCommand: jest.Mock;
      BatchWriteCommand: jest.Mock;
    };
    libDdb.PutCommand.mockImplementation((params: unknown) => ({ ...(params as object), _type: 'Put' }));
    libDdb.DeleteCommand.mockImplementation((params: unknown) => ({ ...(params as object), _type: 'Delete' }));
    libDdb.QueryCommand.mockImplementation((params: unknown) => ({ ...(params as object), _type: 'Query' }));
    libDdb.BatchWriteCommand.mockImplementation((params: unknown) => ({ ...(params as object), _type: 'BatchWrite' }));

    const libS3 = jest.requireMock('@aws-sdk/client-s3') as {
      ListObjectsV2Command: jest.Mock;
      DeleteObjectsCommand: jest.Mock;
    };
    libS3.ListObjectsV2Command.mockImplementation((params: unknown) => ({ ...(params as object), _type: 'ListObjectsV2' }));
    libS3.DeleteObjectsCommand.mockImplementation((params: unknown) => ({ ...(params as object), _type: 'DeleteObjects' }));

    const libCognito = jest.requireMock('@aws-sdk/client-cognito-identity-provider') as {
      AdminDisableUserCommand: jest.Mock;
      AdminDeleteUserCommand: jest.Mock;
    };
    libCognito.AdminDisableUserCommand.mockImplementation((params: unknown) => ({ ...(params as object), _type: 'AdminDisableUser' }));
    libCognito.AdminDeleteUserCommand.mockImplementation((params: unknown) => ({ ...(params as object), _type: 'AdminDeleteUser' }));

    // Default resolved responses — prevents silent undefined resolution when a
    // test does not queue enough Once values for unrelated calls.
    mockDdbSend.mockResolvedValue({});
    mockS3Send.mockResolvedValue({ Contents: [], NextContinuationToken: undefined });
    mockCognitoSend.mockResolvedValue({});

    // DynamoDB env vars
    process.env.PORTFOLIO_TABLE_NAME = 'PortfolioTable';
    process.env.TRADING_SETTINGS_TABLE_NAME = 'TradingSettingsTable';
    process.env.DEMO_BALANCES_TABLE_NAME = 'DemoBalancesTable';
    process.env.PORTFOLIO_PERFORMANCE_TABLE_NAME = 'PortfolioPerformanceTable';
    process.env.TRADING_BOTS_TABLE_NAME = 'TradingBotsTable';
    process.env.TRADING_BACKTESTS_TABLE_NAME = 'TradingBacktestsTable';
    process.env.DEMO_ORDERS_TABLE_NAME = 'DemoOrdersTable';
    process.env.TRADING_TRADES_TABLE_NAME = 'TradingTradesTable';
    process.env.TRADING_BOT_PERFORMANCE_TABLE_NAME = 'TradingBotPerformanceTable';

    // S3 and Cognito env vars
    process.env.BACKTEST_REPORTS_BUCKET_NAME = 'backtest-reports-bucket';
    process.env.USER_POOL_ID = 'ap-southeast-2_TestPool';
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  /** Verifies that a missing sub claim causes a 401 response. */
  it('returns 401 when sub claim is missing', async () => {
    const event = buildEvent({
      requestContext: {
        authorizer: { claims: { 'cognito:username': 'testuser' } },
      } as unknown as APIGatewayProxyEvent['requestContext'],
    });

    const result = await deleteAccount(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  /** Verifies that an empty authorizer context causes a 401 response. */
  it('returns 401 when authorizer claims are absent', async () => {
    const event = buildEvent({
      requestContext: {} as unknown as APIGatewayProxyEvent['requestContext'],
    });

    const result = await deleteAccount(event);

    expect(result.statusCode).toBe(401);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  /** Verifies a fully successful delete returns 200 with a confirmation message. */
  it('returns 200 with a success message on a complete account deletion', async () => {
    const result = await deleteAccount(buildAuthEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.message).toBe('Account deleted successfully');
  });

  // ── Single-key DynamoDB tables ─────────────────────────────────────────────

  /** Verifies that DeleteCommand is called for each of the three simple tables. */
  it('sends a DeleteCommand for each single-key table (portfolio, settings, demo-balances)', async () => {
    await deleteAccount(buildAuthEvent());

    const { DeleteCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { DeleteCommand: jest.Mock };
    const deleteCalls = DeleteCommand.mock.calls.map((c: unknown[]) => c[0]) as Array<{ TableName: string; Key: { sub: string } }>;

    const tableNames = deleteCalls.map((c) => c.TableName);
    expect(tableNames).toContain('PortfolioTable');
    expect(tableNames).toContain('TradingSettingsTable');
    expect(tableNames).toContain('DemoBalancesTable');

    deleteCalls.forEach((call) => {
      expect(call.Key.sub).toBe('user-sub-123');
    });
  });

  // ── Composite-key DynamoDB tables ──────────────────────────────────────────

  /** Verifies that each composite-key table is queried with the correct params. */
  it('queries composite-key tables with KeyConditionExpression on sub', async () => {
    await deleteAccount(buildAuthEvent());

    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    const queryCalls = QueryCommand.mock.calls.map((c: unknown[]) => c[0]) as Array<{
      TableName: string;
      KeyConditionExpression: string;
      ExpressionAttributeValues: Record<string, string>;
    }>;

    const compositeQueryTables = queryCalls
      .filter((c) => !c.TableName.includes('Trades') && !c.TableName.includes('BotPerformance'))
      .map((c) => c.TableName);

    expect(compositeQueryTables).toContain('PortfolioPerformanceTable');
    expect(compositeQueryTables).toContain('TradingBotsTable');
    expect(compositeQueryTables).toContain('TradingBacktestsTable');
    expect(compositeQueryTables).toContain('DemoOrdersTable');

    queryCalls.forEach((call) => {
      expect(call.ExpressionAttributeValues[':pk'] ?? call.ExpressionAttributeValues[':gsiPk']).toBe('user-sub-123');
    });
  });

  /** Verifies BatchWriteCommand is sent when composite-key tables have items. */
  it('sends BatchWriteCommand to delete items found in a composite-key table', async () => {
    // Use a command-dispatch implementation so parallel calls are handled reliably.
    // portfolio-performance returns two items; all other tables return nothing.
    mockDdbSend.mockImplementation((cmd: { _type: string; TableName: string }) => {
      if (cmd._type === 'Query' && cmd.TableName === 'PortfolioPerformanceTable') {
        return Promise.resolve({
          Items: [
            { sub: 'user-sub-123', timestamp: 't1' },
            { sub: 'user-sub-123', timestamp: 't2' },
          ],
        });
      }
      // Default for single-deletes, other queries, and batch writes
      return Promise.resolve({});
    });

    await deleteAccount(buildAuthEvent());

    const { BatchWriteCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { BatchWriteCommand: jest.Mock };
    expect(BatchWriteCommand.mock.calls.length).toBeGreaterThanOrEqual(1);

    const firstBatch = BatchWriteCommand.mock.calls[0][0] as {
      RequestItems: Record<string, Array<{ DeleteRequest: { Key: Record<string, string> } }>>;
    };
    const deleteRequests = firstBatch.RequestItems['PortfolioPerformanceTable'];
    expect(deleteRequests).toHaveLength(2);
    expect(deleteRequests[0].DeleteRequest.Key.sub).toBe('user-sub-123');
    expect(deleteRequests[0].DeleteRequest.Key.timestamp).toBe('t1');
    expect(deleteRequests[1].DeleteRequest.Key.timestamp).toBe('t2');
  });

  // ── GSI DynamoDB tables ────────────────────────────────────────────────────

  /** Verifies GSI tables are queried via the sub-index. */
  it('queries GSI tables using the sub-index and correct pk/sk projections', async () => {
    await deleteAccount(buildAuthEvent());

    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    const queryCalls = QueryCommand.mock.calls.map((c: unknown[]) => c[0]) as Array<{
      TableName: string;
      IndexName?: string;
      ExpressionAttributeNames: Record<string, string>;
    }>;

    const gsiCalls = queryCalls.filter((c) => c.IndexName === 'sub-index');
    expect(gsiCalls).toHaveLength(2);

    const gsiTableNames = gsiCalls.map((c) => c.TableName);
    expect(gsiTableNames).toContain('TradingTradesTable');
    expect(gsiTableNames).toContain('TradingBotPerformanceTable');

    gsiCalls.forEach((call) => {
      expect(call.ExpressionAttributeNames['#gsiPk']).toBe('sub');
    });
  });

  /** Verifies BatchWriteCommand is sent with correct composite keys for GSI-found items. */
  it('sends BatchWriteCommand with correct composite keys for GSI-found items', async () => {
    // Return a trade record only for TradingTradesTable GSI query; empty everywhere else.
    mockDdbSend.mockImplementation((cmd: { _type: string; TableName: string; IndexName?: string }) => {
      if (cmd._type === 'Query' && cmd.TableName === 'TradingTradesTable' && cmd.IndexName === 'sub-index') {
        return Promise.resolve({ Items: [{ botId: 'bot-001', timestamp: 'ts-1' }] });
      }
      return Promise.resolve({});
    });

    await deleteAccount(buildAuthEvent());

    const { BatchWriteCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { BatchWriteCommand: jest.Mock };
    expect(BatchWriteCommand.mock.calls.length).toBeGreaterThanOrEqual(1);

    const batchCall = BatchWriteCommand.mock.calls[0][0] as {
      RequestItems: Record<string, Array<{ DeleteRequest: { Key: Record<string, string> } }>>;
    };
    const tradeRequests = batchCall.RequestItems['TradingTradesTable'];
    expect(tradeRequests).toHaveLength(1);
    expect(tradeRequests[0].DeleteRequest.Key.botId).toBe('bot-001');
    expect(tradeRequests[0].DeleteRequest.Key.timestamp).toBe('ts-1');
  });

  // ── Pagination ─────────────────────────────────────────────────────────────

  /** Verifies that paginated composite-key queries loop until LastEvaluatedKey is absent. */
  it('paginates composite-key queries when LastEvaluatedKey is present', async () => {
    // Use a stateful counter per-table to simulate two pages for PortfolioPerformanceTable.
    // This is necessary because all tables process in parallel (Promise.all), so a simple
    // mockResolvedValueOnce queue cannot reliably map to per-table call order.
    let perfPageCount = 0;
    mockDdbSend.mockImplementation((cmd: { _type: string; TableName: string }) => {
      if (cmd._type === 'Query' && cmd.TableName === 'PortfolioPerformanceTable') {
        perfPageCount += 1;
        if (perfPageCount === 1) {
          return Promise.resolve({
            Items: [{ sub: 'user-sub-123', timestamp: 'ts-page1' }],
            LastEvaluatedKey: { sub: 'user-sub-123', timestamp: 'ts-page1' },
          });
        }
        // Second page — no more results
        return Promise.resolve({ Items: [{ sub: 'user-sub-123', timestamp: 'ts-page2' }] });
      }
      return Promise.resolve({});
    });

    await deleteAccount(buildAuthEvent());

    const { QueryCommand, BatchWriteCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as {
      QueryCommand: jest.Mock;
      BatchWriteCommand: jest.Mock;
    };

    // Two QueryCommands for PortfolioPerformanceTable (one per page)
    const perfQueries = (QueryCommand.mock.calls.map((c: unknown[]) => c[0]) as Array<{ TableName: string }>)
      .filter((c) => c.TableName === 'PortfolioPerformanceTable');
    expect(perfQueries).toHaveLength(2);

    // Two BatchWriteCommands (one per page of results)
    const perfBatches = (BatchWriteCommand.mock.calls.map((c: unknown[]) => c[0]) as Array<{
      RequestItems: Record<string, unknown>;
    }>).filter((c) => c.RequestItems && 'PortfolioPerformanceTable' in c.RequestItems);
    expect(perfBatches).toHaveLength(2);
  });

  /** Verifies that paginated GSI queries loop until LastEvaluatedKey is absent. */
  it('paginates GSI queries when LastEvaluatedKey is present', async () => {
    // Stateful counter for TradingTradesTable GSI queries.
    let tradeGsiPageCount = 0;
    mockDdbSend.mockImplementation((cmd: { _type: string; TableName: string; IndexName?: string }) => {
      if (cmd._type === 'Query' && cmd.TableName === 'TradingTradesTable' && cmd.IndexName === 'sub-index') {
        tradeGsiPageCount += 1;
        if (tradeGsiPageCount === 1) {
          return Promise.resolve({
            Items: [{ botId: 'b1', timestamp: 'ts1' }],
            LastEvaluatedKey: { botId: 'b1', timestamp: 'ts1' },
          });
        }
        return Promise.resolve({ Items: [{ botId: 'b2', timestamp: 'ts2' }] });
      }
      return Promise.resolve({});
    });

    await deleteAccount(buildAuthEvent());

    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    const tradeGsiQueries = (QueryCommand.mock.calls.map((c: unknown[]) => c[0]) as Array<{ TableName: string; IndexName?: string }>)
      .filter((c) => c.TableName === 'TradingTradesTable' && c.IndexName === 'sub-index');
    expect(tradeGsiQueries).toHaveLength(2);
  });

  // ── S3 cleanup ─────────────────────────────────────────────────────────────

  /** Verifies the correct bucket and prefix are used when listing S3 objects. */
  it('lists S3 objects under the backtests/{sub}/ prefix', async () => {
    await deleteAccount(buildAuthEvent());

    const { ListObjectsV2Command } = jest.requireMock('@aws-sdk/client-s3') as { ListObjectsV2Command: jest.Mock };
    expect(ListObjectsV2Command.mock.calls).toHaveLength(1);
    const listParams = ListObjectsV2Command.mock.calls[0][0] as { Bucket: string; Prefix: string };
    expect(listParams.Bucket).toBe('backtest-reports-bucket');
    expect(listParams.Prefix).toBe('backtests/user-sub-123/');
  });

  /** Verifies DeleteObjectsCommand is sent when S3 objects are found. */
  it('sends DeleteObjectsCommand for found S3 objects', async () => {
    // First S3 list returns two objects, no further pages.
    mockS3Send.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'ListObjectsV2') {
        return Promise.resolve({
          Contents: [
            { Key: 'backtests/user-sub-123/report-1.json' },
            { Key: 'backtests/user-sub-123/report-2.json' },
          ],
          NextContinuationToken: undefined,
        });
      }
      return Promise.resolve({}); // DeleteObjectsCommand
    });

    await deleteAccount(buildAuthEvent());

    const { DeleteObjectsCommand } = jest.requireMock('@aws-sdk/client-s3') as { DeleteObjectsCommand: jest.Mock };
    expect(DeleteObjectsCommand.mock.calls).toHaveLength(1);

    const deleteParams = DeleteObjectsCommand.mock.calls[0][0] as {
      Bucket: string;
      Delete: { Objects: Array<{ Key: string }> };
    };
    expect(deleteParams.Bucket).toBe('backtest-reports-bucket');
    expect(deleteParams.Delete.Objects).toEqual([
      { Key: 'backtests/user-sub-123/report-1.json' },
      { Key: 'backtests/user-sub-123/report-2.json' },
    ]);
  });

  /** Verifies DeleteObjectsCommand is NOT sent when S3 listing is empty. */
  it('does not send DeleteObjectsCommand when S3 listing returns no objects', async () => {
    // The default mockS3Send implementation already returns empty Contents.
    await deleteAccount(buildAuthEvent());

    const { DeleteObjectsCommand } = jest.requireMock('@aws-sdk/client-s3') as { DeleteObjectsCommand: jest.Mock };
    expect(DeleteObjectsCommand.mock.calls).toHaveLength(0);
  });

  /** Verifies S3 pagination loops via NextContinuationToken. */
  it('paginates S3 listings when NextContinuationToken is present', async () => {
    let s3PageCount = 0;
    mockS3Send.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'ListObjectsV2') {
        s3PageCount += 1;
        if (s3PageCount === 1) {
          return Promise.resolve({
            Contents: [{ Key: 'backtests/user-sub-123/page1.json' }],
            NextContinuationToken: 'token-abc',
          });
        }
        // Second listing — final page, no continuation token
        return Promise.resolve({
          Contents: [{ Key: 'backtests/user-sub-123/page2.json' }],
          NextContinuationToken: undefined,
        });
      }
      return Promise.resolve({}); // DeleteObjectsCommand calls
    });

    await deleteAccount(buildAuthEvent());

    const { ListObjectsV2Command, DeleteObjectsCommand } = jest.requireMock('@aws-sdk/client-s3') as {
      ListObjectsV2Command: jest.Mock;
      DeleteObjectsCommand: jest.Mock;
    };

    // Two ListObjectsV2 calls
    expect(ListObjectsV2Command.mock.calls).toHaveLength(2);

    // The second listing must pass the continuation token
    const secondListParams = ListObjectsV2Command.mock.calls[1][0] as { ContinuationToken?: string };
    expect(secondListParams.ContinuationToken).toBe('token-abc');

    // Two DeleteObjects calls (one per page of results)
    expect(DeleteObjectsCommand.mock.calls).toHaveLength(2);
  });

  // ── Cognito cleanup ────────────────────────────────────────────────────────

  /** Verifies AdminDisableUserCommand is called with correct user pool and username. */
  it('disables the Cognito user with the correct user pool and username', async () => {
    await deleteAccount(buildAuthEvent());

    const { AdminDisableUserCommand } = jest.requireMock('@aws-sdk/client-cognito-identity-provider') as {
      AdminDisableUserCommand: jest.Mock;
    };
    expect(AdminDisableUserCommand.mock.calls).toHaveLength(1);
    const disableParams = AdminDisableUserCommand.mock.calls[0][0] as { UserPoolId: string; Username: string };
    expect(disableParams.UserPoolId).toBe('ap-southeast-2_TestPool');
    expect(disableParams.Username).toBe('testuser');
  });

  /** Verifies AdminDeleteUserCommand is called with correct user pool and username. */
  it('deletes the Cognito user with the correct user pool and username', async () => {
    await deleteAccount(buildAuthEvent());

    const { AdminDeleteUserCommand } = jest.requireMock('@aws-sdk/client-cognito-identity-provider') as {
      AdminDeleteUserCommand: jest.Mock;
    };
    expect(AdminDeleteUserCommand.mock.calls).toHaveLength(1);
    const deleteParams = AdminDeleteUserCommand.mock.calls[0][0] as { UserPoolId: string; Username: string };
    expect(deleteParams.UserPoolId).toBe('ap-southeast-2_TestPool');
    expect(deleteParams.Username).toBe('testuser');
  });

  /** Verifies AdminDisableUserCommand is called before AdminDeleteUserCommand. */
  it('disables the Cognito user before deleting it', async () => {
    // Track call order using the _type field (available because constructor
    // implementations are restored in beforeEach).
    const callOrder: string[] = [];
    mockCognitoSend.mockImplementation((cmd: { _type: string }) => {
      callOrder.push(cmd._type);
      return Promise.resolve({});
    });

    await deleteAccount(buildAuthEvent());

    expect(callOrder[0]).toBe('AdminDisableUser');
    expect(callOrder[1]).toBe('AdminDeleteUser');
  });

  // ── Error propagation ──────────────────────────────────────────────────────

  /** Verifies that a DynamoDB failure is propagated as an unhandled rejection. */
  it('propagates DynamoDB errors as rejected promises', async () => {
    mockDdbSend.mockRejectedValue(new Error('DynamoDB service unavailable'));

    await expect(deleteAccount(buildAuthEvent())).rejects.toThrow('DynamoDB service unavailable');
  });

  /** Verifies that a Cognito AdminDisableUser failure propagates. */
  it('propagates Cognito errors as rejected promises', async () => {
    // Use mockRejectedValue (not Once) to ensure the rejection is used even if Jest's
    // internal implementation priority differs between mockResolvedValue and mockImplementation.
    mockCognitoSend.mockRejectedValue(new Error('UserNotFoundException'));

    await expect(deleteAccount(buildAuthEvent())).rejects.toThrow('UserNotFoundException');
  });
});
