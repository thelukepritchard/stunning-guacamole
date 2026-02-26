import { buildEvent } from '../../test-utils';

// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockDdbSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockDdbSend }) },
  QueryCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetCommand: jest.fn().mockImplementation((input) => ({ input })),
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
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await listTrades(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 200 with items on success.
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
    const call = mockDdbSend.mock.calls[0][0];
    expect(call.input.Limit).toBe(50);
  });

  /**
   * Should honour a custom limit from query string.
   */
  it('should honour custom limit from query string', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    await listTrades(authedEvent({ queryStringParameters: { limit: '10' } }));
    const call = mockDdbSend.mock.calls[0][0];
    expect(call.input.Limit).toBe(10);
  });
});

// ─── listBotTrades ────────────────────────────────────────────────────────────

describe('listBotTrades', () => {
  beforeEach(() => jest.clearAllMocks());

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
});
