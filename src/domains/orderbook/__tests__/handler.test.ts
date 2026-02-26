const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { handler } from '../index';
import { buildEvent } from '../../test-utils';

beforeEach(() => {
  jest.resetAllMocks();
  process.env.DEMO_EXCHANGE_API_URL = 'https://demo-api.example.com/';
});

/**
 * Builds a mock event with Cognito authorizer claims.
 */
function buildAuthEvent(overrides: Partial<Parameters<typeof buildEvent>[0]> = {}) {
  return buildEvent({
    ...overrides,
    requestContext: {
      authorizer: { claims: { sub: 'user-123' } },
    } as never,
  });
}

describe('orderbook handler', () => {
  /** Verifies GET /orderbook/balance routes to getBalance. */
  it('routes GET /orderbook/balance to getBalance', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sub: 'user-123', usd: 1000, btc: 0 }),
    });

    const result = await handler(buildAuthEvent({
      httpMethod: 'GET',
      resource: '/orderbook/balance',
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).exchange).toBe('demo');
  });

  /** Verifies GET /orderbook/pairs routes to getPairs. */
  it('routes GET /orderbook/pairs to getPairs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ pairs: [{ symbol: 'BTC/USD', base: 'BTC', quote: 'USD' }] }),
    });

    const result = await handler(buildAuthEvent({
      httpMethod: 'GET',
      resource: '/orderbook/pairs',
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).pairs).toHaveLength(1);
  });

  /** Verifies GET /orderbook/orders routes to listOrders. */
  it('routes GET /orderbook/orders to listOrders', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ orders: [] }),
    });

    const result = await handler(buildAuthEvent({
      httpMethod: 'GET',
      resource: '/orderbook/orders',
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).orders).toEqual([]);
  });

  /** Verifies DELETE /orderbook/orders/{orderId} routes to cancelOrder. */
  it('routes DELETE /orderbook/orders/{orderId} to cancelOrder', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: 'Order cancelled', orderId: 'o1' }),
    });

    const result = await handler(buildAuthEvent({
      httpMethod: 'DELETE',
      resource: '/orderbook/orders/{orderId}',
      pathParameters: { orderId: 'o1' },
    }));

    expect(result.statusCode).toBe(200);
  });

  /** Verifies unknown routes return 404. */
  it('returns 404 for unknown routes', async () => {
    const result = await handler(buildAuthEvent({
      httpMethod: 'PATCH',
      resource: '/orderbook/balance',
    }));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
