import { buildEvent } from '../../test-utils';

// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockDdbSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockDdbSend }) },
  QueryCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Query' })),
  GetCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Get' })),
}));

import { listTrades } from '../routes/list-trades';
import { listBotTrades } from '../routes/list-bot-trades';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a minimal authenticated event stub.
 */
function authedEvent(overrides = {}) {
  return buildEvent({
    requestContext: {
      authorizer: { claims: { sub: 'user-123' } },
    } as never,
    ...overrides,
  });
}

// ─── listTrades ───────────────────────────────────────────────────────────────

describe('listTrades', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const { QueryCommand, GetCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as {
      QueryCommand: jest.Mock;
      GetCommand: jest.Mock;
    };
    QueryCommand.mockImplementation((params: object) => ({ ...params, _type: 'Query' }));
    GetCommand.mockImplementation((params: object) => ({ ...params, _type: 'Get' }));
  });

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await listTrades(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 200 with items on success (no pagination token in response).
   */
  it('should return 200 with items on success', async () => {
    const trade = { botId: 'b1', timestamp: '2024-01-01T00:00:00.000Z', action: 'buy' };
    mockDdbSend.mockResolvedValueOnce({ Items: [trade] });
    const result = await listTrades(authedEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ items: [trade] });
  });

  /**
   * Should return empty items when no trades exist.
   */
  it('should return empty items when no trades exist', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: undefined });
    const result = await listTrades(authedEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ items: [] });
  });

  /**
   * Should use default limit of 50.
   */
  it('should use default limit of 50', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    await listTrades(authedEvent());
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    expect(QueryCommand.mock.calls[0][0].Limit).toBe(50);
  });

  /**
   * Should honour a custom limit from query string.
   */
  it('should honour custom limit from query string', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    await listTrades(authedEvent({ queryStringParameters: { limit: '10' } }));
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    expect(QueryCommand.mock.calls[0][0].Limit).toBe(10);
  });

  /**
   * Should query the TRADES_TABLE_NAME table with sub-index and the caller's sub.
   */
  it('should query TRADES_TABLE_NAME with sub-index for the authenticated user', async () => {
    process.env.TRADES_TABLE_NAME = 'trades-table';
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    await listTrades(authedEvent());
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    const params = QueryCommand.mock.calls[0][0];
    expect(params.TableName).toBe('trades-table');
    expect(params.IndexName).toBe('sub-index');
    expect(params.ExpressionAttributeValues[':sub']).toBe('user-123');
    expect(params.ScanIndexForward).toBe(false);
  });

  /**
   * Should include a nextToken in the response when DynamoDB returns a LastEvaluatedKey.
   */
  it('should return nextToken when DynamoDB returns LastEvaluatedKey', async () => {
    const trade = { botId: 'b1', timestamp: '2024-01-01T00:00:00.000Z', action: 'buy' };
    const lastKey = { sub: 'user-123', botId: 'b1', timestamp: '2024-01-01T00:00:00.000Z' };
    mockDdbSend.mockResolvedValueOnce({ Items: [trade], LastEvaluatedKey: lastKey });
    const result = await listTrades(authedEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toEqual([trade]);
    expect(body.nextToken).toBeDefined();
    // The token must be a base64url-encoded JSON of the LastEvaluatedKey.
    const decoded = JSON.parse(Buffer.from(body.nextToken, 'base64url').toString('utf-8'));
    expect(decoded).toEqual(lastKey);
  });

  /**
   * Should omit nextToken from the response when DynamoDB has no LastEvaluatedKey.
   */
  it('should omit nextToken when DynamoDB has no LastEvaluatedKey', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    const result = await listTrades(authedEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.nextToken).toBeUndefined();
  });

  /**
   * Should decode a valid nextToken and pass it as ExclusiveStartKey to DynamoDB.
   */
  it('should pass ExclusiveStartKey to DynamoDB when nextToken is provided', async () => {
    const lastKey = { sub: 'user-123', botId: 'b1', timestamp: '2024-01-01T00:00:00.000Z' };
    const nextToken = Buffer.from(JSON.stringify(lastKey)).toString('base64url');
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    await listTrades(authedEvent({ queryStringParameters: { nextToken } }));
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    const params = QueryCommand.mock.calls[0][0];
    expect(params.ExclusiveStartKey).toEqual(lastKey);
  });

  /**
   * Should not set ExclusiveStartKey when no nextToken query param is provided.
   */
  it('should not set ExclusiveStartKey when nextToken is absent', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    await listTrades(authedEvent());
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    const params = QueryCommand.mock.calls[0][0];
    expect(params.ExclusiveStartKey).toBeUndefined();
  });

  /**
   * Should return 400 when the nextToken query param is not valid base64url-encoded JSON.
   */
  it('should return 400 when nextToken is invalid', async () => {
    const result = await listTrades(authedEvent({ queryStringParameters: { nextToken: '!!!not-valid-base64!!!' } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Invalid nextToken');
  });
});

// ─── listBotTrades ────────────────────────────────────────────────────────────

describe('listBotTrades', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const { QueryCommand, GetCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as {
      QueryCommand: jest.Mock;
      GetCommand: jest.Mock;
    };
    QueryCommand.mockImplementation((params: object) => ({ ...params, _type: 'Query' }));
    GetCommand.mockImplementation((params: object) => ({ ...params, _type: 'Get' }));
  });

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await listBotTrades(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when botId is missing.
   */
  it('should return 400 when botId is missing', async () => {
    const result = await listBotTrades(authedEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing botId');
  });

  /**
   * Should return 404 when bot does not belong to the user.
   */
  it('should return 404 when bot not found', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });
    const result = await listBotTrades(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(404);
  });

  /**
   * Should return 200 with trades when bot exists and belongs to user.
   */
  it('should return 200 with trades on success', async () => {
    const bot = { botId: 'b1', sub: 'user-123' };
    const trades = [{ botId: 'b1', action: 'buy' }];
    mockDdbSend
      .mockResolvedValueOnce({ Item: bot })
      .mockResolvedValueOnce({ Items: trades });
    const result = await listBotTrades(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ items: trades });
  });

  /**
   * Should verify bot ownership using BOTS_TABLE_NAME with the caller's sub and botId as the key.
   */
  it('should verify bot ownership against BOTS_TABLE_NAME using sub and botId', async () => {
    process.env.BOTS_TABLE_NAME = 'bots-table';
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });
    await listBotTrades(authedEvent({ pathParameters: { botId: 'b1' } }));
    const { GetCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { GetCommand: jest.Mock };
    const params = GetCommand.mock.calls[0][0];
    expect(params.TableName).toBe('bots-table');
    expect(params.Key).toEqual({ sub: 'user-123', botId: 'b1' });
  });

  /**
   * Should query TRADES_TABLE_NAME by botId after confirming bot ownership.
   */
  it('should query TRADES_TABLE_NAME by botId with newest-first ordering', async () => {
    process.env.TRADES_TABLE_NAME = 'trades-table';
    const bot = { botId: 'b1', sub: 'user-123' };
    mockDdbSend
      .mockResolvedValueOnce({ Item: bot })
      .mockResolvedValueOnce({ Items: [] });
    await listBotTrades(authedEvent({ pathParameters: { botId: 'b1' } }));
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    const params = QueryCommand.mock.calls[0][0];
    expect(params.TableName).toBe('trades-table');
    expect(params.ExpressionAttributeValues[':botId']).toBe('b1');
    expect(params.ScanIndexForward).toBe(false);
  });

  /**
   * Should include a nextToken in the response when DynamoDB returns a LastEvaluatedKey.
   */
  it('should return nextToken when DynamoDB returns LastEvaluatedKey', async () => {
    const bot = { botId: 'b1', sub: 'user-123' };
    const trade = { botId: 'b1', timestamp: '2024-01-01T00:00:00.000Z', action: 'sell' };
    const lastKey = { botId: 'b1', timestamp: '2024-01-01T00:00:00.000Z' };
    mockDdbSend
      .mockResolvedValueOnce({ Item: bot })
      .mockResolvedValueOnce({ Items: [trade], LastEvaluatedKey: lastKey });
    const result = await listBotTrades(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toEqual([trade]);
    expect(body.nextToken).toBeDefined();
    // The token must be a base64url-encoded JSON of the LastEvaluatedKey.
    const decoded = JSON.parse(Buffer.from(body.nextToken, 'base64url').toString('utf-8'));
    expect(decoded).toEqual(lastKey);
  });

  /**
   * Should omit nextToken from the response when DynamoDB has no LastEvaluatedKey.
   */
  it('should omit nextToken when DynamoDB has no LastEvaluatedKey', async () => {
    const bot = { botId: 'b1', sub: 'user-123' };
    mockDdbSend
      .mockResolvedValueOnce({ Item: bot })
      .mockResolvedValueOnce({ Items: [] });
    const result = await listBotTrades(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.nextToken).toBeUndefined();
  });

  /**
   * Should decode a valid nextToken and pass it as ExclusiveStartKey to the trades query.
   */
  it('should pass ExclusiveStartKey to DynamoDB when nextToken is provided', async () => {
    const bot = { botId: 'b1', sub: 'user-123' };
    const lastKey = { botId: 'b1', timestamp: '2024-01-01T00:00:00.000Z' };
    const nextToken = Buffer.from(JSON.stringify(lastKey)).toString('base64url');
    mockDdbSend
      .mockResolvedValueOnce({ Item: bot })
      .mockResolvedValueOnce({ Items: [] });
    await listBotTrades(authedEvent({
      pathParameters: { botId: 'b1' },
      queryStringParameters: { nextToken },
    }));
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    // QueryCommand.mock.calls[0] is the trades query (first QueryCommand constructed).
    const params = QueryCommand.mock.calls[0][0];
    expect(params.ExclusiveStartKey).toEqual(lastKey);
  });

  /**
   * Should not set ExclusiveStartKey on the trades query when no nextToken is provided.
   */
  it('should not set ExclusiveStartKey when nextToken is absent', async () => {
    const bot = { botId: 'b1', sub: 'user-123' };
    mockDdbSend
      .mockResolvedValueOnce({ Item: bot })
      .mockResolvedValueOnce({ Items: [] });
    await listBotTrades(authedEvent({ pathParameters: { botId: 'b1' } }));
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    const params = QueryCommand.mock.calls[0][0];
    expect(params.ExclusiveStartKey).toBeUndefined();
  });

  /**
   * Should return 400 when the nextToken query param is not valid base64url-encoded JSON.
   */
  it('should return 400 when nextToken is invalid', async () => {
    const bot = { botId: 'b1', sub: 'user-123' };
    mockDdbSend.mockResolvedValueOnce({ Item: bot });
    const result = await listBotTrades(authedEvent({
      pathParameters: { botId: 'b1' },
      queryStringParameters: { nextToken: '!!!not-valid-base64!!!' },
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Invalid nextToken');
  });
});
