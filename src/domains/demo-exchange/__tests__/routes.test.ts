import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  GetCommand: jest.fn((params) => ({ ...params, _type: 'Get' })),
  PutCommand: jest.fn((params) => ({ ...params, _type: 'Put' })),
  TransactWriteCommand: jest.fn((params) => ({ ...params, _type: 'TransactWrite' })),
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
}));

import { getBalance } from '../routes/get-balance';
import { getPairs } from '../routes/get-pairs';
import { placeOrder } from '../routes/place-order';
import { listOrders } from '../routes/list-orders';
import { cancelOrder } from '../routes/cancel-order';

/**
 * Builds a mock API Gateway event for demo exchange route tests.
 *
 * @param overrides - Partial event properties to merge into defaults.
 * @returns A fully-formed mock API Gateway proxy event.
 */
function buildRouteEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    resource: '/demo-exchange/balance',
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: '/demo-exchange/balance',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  process.env.BALANCES_TABLE_NAME = 'BalancesTable';
  process.env.ORDERS_TABLE_NAME = 'OrdersTable';
});

describe('getBalance', () => {
  /** Verifies missing sub returns 400. */
  it('returns 400 when sub is missing', async () => {
    const result = await getBalance(buildRouteEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('sub');
  });

  /** Verifies existing balance is returned. */
  it('returns existing balance for a user', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { sub: 'u1', usd: 500, btc: 0.1, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    });

    const result = await getBalance(buildRouteEvent({
      queryStringParameters: { sub: 'u1' },
    }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.usd).toBe(500);
    expect(body.btc).toBe(0.1);
  });

  /** Verifies a new balance is seeded for a first-time user. */
  it('seeds a default balance for a new user', async () => {
    // GetCommand returns no item (new user)
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // PutCommand succeeds — ensureBalance returns newBalance directly
    mockSend.mockResolvedValueOnce({});

    const result = await getBalance(buildRouteEvent({
      queryStringParameters: { sub: 'new-user' },
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).usd).toBe(1000);
    expect(JSON.parse(result.body).btc).toBe(0);
  });
});

describe('getPairs', () => {
  /** Verifies pairs are returned with BTC/USD. */
  it('returns available demo pairs', async () => {
    const result = await getPairs(buildRouteEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0].symbol).toBe('BTC/USD');
  });
});

describe('placeOrder', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  /** Verifies invalid JSON body returns 400. */
  it('returns 400 for invalid JSON body', async () => {
    const result = await placeOrder(buildRouteEvent({
      httpMethod: 'POST',
      body: 'not json',
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Invalid JSON');
  });

  /** Verifies missing fields return 400. */
  it('returns 400 when required fields are missing', async () => {
    const result = await placeOrder(buildRouteEvent({
      httpMethod: 'POST',
      body: JSON.stringify({ sub: 'u1' }),
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Missing required fields');
  });

  /** Verifies invalid side returns 400. */
  it('returns 400 for invalid side', async () => {
    const result = await placeOrder(buildRouteEvent({
      httpMethod: 'POST',
      body: JSON.stringify({ sub: 'u1', pair: 'BTC/USD', side: 'hold', size: 0.01 }),
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('side');
  });

  /** Verifies unsupported pair returns 400. */
  it('returns 400 for unsupported pair', async () => {
    const result = await placeOrder(buildRouteEvent({
      httpMethod: 'POST',
      body: JSON.stringify({ sub: 'u1', pair: 'ETH/USD', side: 'buy', size: 1 }),
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Unsupported pair');
  });

  /** Verifies a successful buy order fills and returns 201. */
  it('places a buy order and returns the filled order', async () => {
    // ensureBalance: GetCommand returns existing balance
    mockSend.mockResolvedValueOnce({
      Item: { sub: 'u1', usd: 1000, btc: 0, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    });
    // Binance price fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ symbol: 'BTCUSDT', price: '50000.00' }),
    });
    // TransactWriteCommand (balance update + order record) succeeds
    mockSend.mockResolvedValueOnce({});

    const result = await placeOrder(buildRouteEvent({
      httpMethod: 'POST',
      body: JSON.stringify({ sub: 'u1', pair: 'BTC/USD', side: 'buy', size: 0.01 }),
    }));

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.side).toBe('buy');
    expect(body.size).toBe(0.01);
    expect(body.executedPrice).toBe(50000);
    expect(body.total).toBe(500);
    expect(body.status).toBe('filled');
  });

  /** Verifies insufficient balance returns 400. */
  it('returns 400 for insufficient balance on buy', async () => {
    // ensureBalance: GetCommand returns low balance
    mockSend.mockResolvedValueOnce({
      Item: { sub: 'u1', usd: 10, btc: 0, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    });
    // Binance price fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ symbol: 'BTCUSDT', price: '50000.00' }),
    });
    // TransactWriteCommand fails with TransactionCanceledException
    const txError = new Error('TransactionCanceled');
    txError.name = 'TransactionCanceledException';
    mockSend.mockRejectedValueOnce(txError);

    const result = await placeOrder(buildRouteEvent({
      httpMethod: 'POST',
      body: JSON.stringify({ sub: 'u1', pair: 'BTC/USD', side: 'buy', size: 1 }),
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Insufficient USD');
  });

  /** Verifies a successful sell order fills and returns 201. */
  it('places a sell order and returns the filled order', async () => {
    // ensureBalance: GetCommand returns existing balance with BTC
    mockSend.mockResolvedValueOnce({
      Item: { sub: 'u1', usd: 500, btc: 0.1, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    });
    // Binance price fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ symbol: 'BTCUSDT', price: '60000.00' }),
    });
    // TransactWriteCommand succeeds
    mockSend.mockResolvedValueOnce({});

    const result = await placeOrder(buildRouteEvent({
      httpMethod: 'POST',
      body: JSON.stringify({ sub: 'u1', pair: 'BTC/USD', side: 'sell', size: 0.05 }),
    }));

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.side).toBe('sell');
    expect(body.size).toBe(0.05);
    expect(body.executedPrice).toBe(60000);
    expect(body.total).toBe(3000);
    expect(body.status).toBe('filled');
  });

  /** Verifies Binance API failure returns 502. */
  it('returns 502 when Binance API fails', async () => {
    // ensureBalance
    mockSend.mockResolvedValueOnce({
      Item: { sub: 'u1', usd: 1000, btc: 0, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    });
    // Binance fetch fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await placeOrder(buildRouteEvent({
      httpMethod: 'POST',
      body: JSON.stringify({ sub: 'u1', pair: 'BTC/USD', side: 'buy', size: 0.01 }),
    }));

    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body).error).toContain('Binance');
  });
});

describe('listOrders', () => {
  /** Verifies missing sub returns 400. */
  it('returns 400 when sub is missing', async () => {
    const result = await listOrders(buildRouteEvent());
    expect(result.statusCode).toBe(400);
  });

  /** Verifies orders are returned for a user. */
  it('returns orders for a user', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { sub: 'u1', orderId: 'o1', pair: 'BTC/USD', side: 'buy', status: 'filled' },
      ],
    });

    const result = await listOrders(buildRouteEvent({
      queryStringParameters: { sub: 'u1' },
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).orders).toHaveLength(1);
  });
});

describe('cancelOrder', () => {
  /** Verifies missing sub returns 400. */
  it('returns 400 when sub is missing', async () => {
    const result = await cancelOrder(buildRouteEvent({
      httpMethod: 'DELETE',
      resource: '/demo-exchange/orders/{orderId}',
      pathParameters: { orderId: 'o1' },
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('sub');
  });

  /** Verifies cancel returns 501 (not implemented). */
  it('returns 501 for all cancel requests', async () => {
    const result = await cancelOrder(buildRouteEvent({
      httpMethod: 'DELETE',
      resource: '/demo-exchange/orders/{orderId}',
      pathParameters: { orderId: 'o1' },
      queryStringParameters: { sub: 'u1' },
    }));

    expect(result.statusCode).toBe(501);
    expect(JSON.parse(result.body).error).toContain('not supported');
  });
});
