import { buildEvent } from '../../test-utils';

// ─── Mock global fetch ────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ─── Mock resolveActiveExchange ──────────────────────────────────────────────

jest.mock('../resolve-exchange', () => ({
  resolveActiveExchange: jest.fn().mockResolvedValue({ exchangeId: 'demo' }),
}));

// ─── Route imports ────────────────────────────────────────────────────────────

import { getBalance } from '../routes/get-balance';
import { getPairs } from '../routes/get-pairs';
import { listOrders } from '../routes/list-orders';
import { cancelOrder } from '../routes/cancel-order';

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

/**
 * Creates a mock Response that resolves to JSON.
 */
function mockOkResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response;
}

/**
 * Creates a mock failed Response.
 */
function mockFailResponse(status: number, data: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => data,
  } as unknown as Response;
}

// ─── getBalance ───────────────────────────────────────────────────────────────

describe('exchange getBalance', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await getBalance(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 502 when fetch throws a network error.
   */
  it('should return 502 when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await getBalance(authedEvent());
    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body).error).toBe('Failed to reach demo exchange');
  });

  /**
   * Should propagate upstream error status codes.
   */
  it('should propagate upstream error status', async () => {
    mockFetch
      .mockResolvedValueOnce(mockFailResponse(503, { error: 'Service unavailable' }))
      .mockResolvedValueOnce(mockOkResponse({ price: '50000.00' }));
    const result = await getBalance(authedEvent());
    expect(result.statusCode).toBe(503);
  });

  /**
   * Should return holdings with only USD for a new user (0 BTC).
   */
  it('should return 1 holding for new user with 0 BTC', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOkResponse({ usd: 1000, btc: 0 }))
      .mockResolvedValueOnce(mockOkResponse({ price: '50000.00' }));
    const result = await getBalance(authedEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.exchange).toBe('demo');
    expect(body.currency).toBe('AUD');
    expect(body.totalValue).toBe(1000);
    expect(body.holdings).toHaveLength(1);
    expect(body.holdings[0].asset).toBe('AUD');
    expect(body.holdings[0].value).toBe(1000);
  });

  /**
   * Should return holdings with USD and BTC after trading.
   */
  it('should return 2 holdings when user has BTC', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOkResponse({ usd: 500, btc: 0.01 }))
      .mockResolvedValueOnce(mockOkResponse({ price: '50000.00' }));
    const result = await getBalance(authedEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.totalValue).toBe(1000);
    expect(body.holdings).toHaveLength(2);
    expect(body.holdings[0].asset).toBe('AUD');
    expect(body.holdings[0].value).toBe(500);
    expect(body.holdings[1].asset).toBe('BTC');
    expect(body.holdings[1].name).toBe('Bitcoin');
    expect(body.holdings[1].price).toBe(50000);
    expect(body.holdings[1].value).toBe(500);
  });
});

// ─── getPairs ─────────────────────────────────────────────────────────────────

describe('exchange getPairs', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await getPairs(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 502 when fetch throws.
   */
  it('should return 502 when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await getPairs(authedEvent());
    expect(result.statusCode).toBe(502);
  });

  /**
   * Should return 200 with normalised pairs response.
   */
  it('should return 200 with normalised pairs on success', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({
      coins: [{ ticker: 'BTC', name: 'Bitcoin' }],
    }));
    const result = await getPairs(authedEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.exchange).toBe('demo');
    expect(body.baseCurrency).toBe('AUD');
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0].coin).toBe('BTC');
    expect(body.pairs[0].coinName).toBe('Bitcoin');
  });
});

// ─── listOrders ───────────────────────────────────────────────────────────────

describe('exchange listOrders', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await listOrders(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 502 when fetch throws.
   */
  it('should return 502 when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await listOrders(authedEvent());
    expect(result.statusCode).toBe(502);
  });

  /**
   * Should return 200 with normalised orders response.
   */
  it('should return 200 with normalised orders on success', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({
      orders: [{
        orderId: 'o1',
        pair: 'BTC',
        side: 'buy',
        type: 'market',
        size: 0.1,
        executedPrice: 50000,
        total: 5000,
        status: 'filled',
        createdAt: '2024-01-01T00:00:00.000Z',
      }],
    }));
    const result = await listOrders(authedEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.exchange).toBe('demo');
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].price).toBe(50000);
  });
});

// ─── cancelOrder ─────────────────────────────────────────────────────────────

describe('exchange cancelOrder', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await cancelOrder(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when orderId is missing.
   */
  it('should return 400 when orderId is missing', async () => {
    const result = await cancelOrder(authedEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('orderId');
  });

  /**
   * Should return 502 when fetch throws.
   */
  it('should return 502 when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await cancelOrder(authedEvent({ pathParameters: { orderId: 'o1' } }));
    expect(result.statusCode).toBe(502);
  });

  /**
   * Should proxy the upstream response status and body.
   */
  it('should proxy upstream response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 501,
      json: async () => ({ error: 'Not supported' }),
    } as unknown as Response);
    const result = await cancelOrder(authedEvent({ pathParameters: { orderId: 'o1' } }));
    expect(result.statusCode).toBe(501);
  });
});
