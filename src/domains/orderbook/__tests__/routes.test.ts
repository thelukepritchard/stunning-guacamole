import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { getBalance } from '../routes/get-balance';
import { getPairs } from '../routes/get-pairs';
import { listOrders } from '../routes/list-orders';
import { cancelOrder } from '../routes/cancel-order';

/**
 * Builds a mock Cognito-authenticated API Gateway event for route tests.
 *
 * @param overrides - Partial event properties to merge into defaults.
 * @returns A fully-formed mock API Gateway proxy event.
 */
function buildRouteEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    resource: '/orderbook/balance',
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: '/orderbook/balance',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      authorizer: { claims: { sub: 'user-123' } },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  process.env.DEMO_EXCHANGE_API_URL = 'https://demo-api.example.com/';
});

describe('getBalance', () => {
  /** Verifies missing Cognito sub returns 401. */
  it('returns 401 when sub is missing from claims', async () => {
    const result = await getBalance(buildRouteEvent({
      requestContext: { authorizer: { claims: {} } } as unknown as APIGatewayProxyEvent['requestContext'],
    }));

    expect(result.statusCode).toBe(401);
  });

  /** Verifies balance is returned in normalised format. */
  it('returns normalised balance from demo exchange', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sub: 'user-123', usd: 750, btc: 0.02 }),
    });

    const result = await getBalance(buildRouteEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.exchange).toBe('demo');
    expect(body.currency).toBe('USD');
    expect(body.available).toBe(750);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('demo-exchange/balance?sub=user-123'),
    );
  });

  /** Verifies fetch failure returns 502. */
  it('returns 502 when demo exchange is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    const result = await getBalance(buildRouteEvent());

    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body).error).toContain('demo exchange');
  });
});

describe('getPairs', () => {
  /** Verifies pairs are returned in normalised format. */
  it('returns normalised pairs from demo exchange', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        pairs: [{ symbol: 'BTC/USD', base: 'BTC', quote: 'USD' }],
      }),
    });

    const result = await getPairs(buildRouteEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.exchange).toBe('demo');
    expect(body.baseCurrency).toBe('USD');
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0].coin).toBe('BTC');
    expect(body.pairs[0].coinName).toBe('Bitcoin');
  });
});

describe('listOrders', () => {
  /** Verifies orders are returned in normalised format. */
  it('returns normalised orders from demo exchange', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        orders: [{
          orderId: 'o1',
          pair: 'BTC/USD',
          side: 'buy',
          type: 'market',
          size: 0.01,
          executedPrice: 50000,
          total: 500,
          status: 'filled',
          createdAt: '2025-01-01T00:00:00Z',
        }],
      }),
    });

    const result = await listOrders(buildRouteEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.exchange).toBe('demo');
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].orderId).toBe('o1');
    expect(body.orders[0].price).toBe(50000);
  });
});

describe('cancelOrder', () => {
  /** Verifies cancel request is proxied to demo exchange. */
  it('proxies cancel request to demo exchange', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: 'Order cancelled', orderId: 'o1' }),
    });

    const result = await cancelOrder(buildRouteEvent({
      httpMethod: 'DELETE',
      resource: '/orderbook/orders/{orderId}',
      pathParameters: { orderId: 'o1' },
    }));

    expect(result.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('demo-exchange/orders/o1?sub=user-123'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  /** Verifies missing orderId returns 400. */
  it('returns 400 when orderId is missing', async () => {
    const result = await cancelOrder(buildRouteEvent({
      httpMethod: 'DELETE',
      resource: '/orderbook/orders/{orderId}',
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('orderId');
  });
});
