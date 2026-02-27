import { buildEvent } from '../../test-utils';

// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockDdbSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockDdbSend }) },
  QueryCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { getPriceHistory } from '../routes/get-price-history';

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

// ─── getPriceHistory ──────────────────────────────────────────────────────────

describe('getPriceHistory', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await getPriceHistory(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when pair path parameter is missing.
   */
  it('should return 400 when pair is missing', async () => {
    const result = await getPriceHistory(authedEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing pair');
  });

  /**
   * Should return 400 for an invalid period value.
   */
  it('should return 400 for invalid period', async () => {
    const result = await getPriceHistory(authedEvent({
      pathParameters: { pair: 'BTC' },
      queryStringParameters: { period: 'bad' },
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Invalid period');
  });

  /**
   * Should normalise BTC-USDT dash format to BTC.
   */
  it('should normalise dash-separated pair and return 200', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    const result = await getPriceHistory(authedEvent({
      pathParameters: { pair: 'BTC-USDT' },
    }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ items: [] });
  });

  /**
   * Should normalise BTCUSDT no-separator format to BTC.
   */
  it('should normalise no-separator pair (BTCUSDT) and return 200', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [{ pair: 'BTC' }] });
    const result = await getPriceHistory(authedEvent({
      pathParameters: { pair: 'BTCUSDT' },
    }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).items).toHaveLength(1);
  });

  /**
   * Should pass through a simple coin ticker as-is.
   */
  it('should pass through simple coin ticker BTC', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    const result = await getPriceHistory(authedEvent({
      pathParameters: { pair: 'BTC' },
    }));
    expect(result.statusCode).toBe(200);
  });

  /**
   * Should default to 24h period when not specified.
   */
  it('should default to 24h period when period is not provided', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    const result = await getPriceHistory(authedEvent({
      pathParameters: { pair: 'BTC' },
    }));
    expect(result.statusCode).toBe(200);
  });

  /**
   * Should return items for each valid period.
   */
  it.each(['1h', '6h', '24h', '7d', '30d'])('should return 200 for period %s', async (period) => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    const result = await getPriceHistory(authedEvent({
      pathParameters: { pair: 'BTC' },
      queryStringParameters: { period },
    }));
    expect(result.statusCode).toBe(200);
  });
});
