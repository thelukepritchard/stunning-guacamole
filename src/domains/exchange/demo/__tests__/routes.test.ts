import { buildEvent } from '../../../test-utils';

// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockDdbSend = jest.fn();
const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockDdbSend }) },
  GetCommand: jest.fn().mockImplementation((input) => ({ input })),
  PutCommand: jest.fn().mockImplementation((input) => ({ input })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ input })),
  TransactWriteCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { getBalance } from '../routes/get-balance';
import { getPairs } from '../routes/get-pairs';
import { placeOrder } from '../routes/place-order';
import { listOrders } from '../routes/list-orders';
import { cancelOrder } from '../routes/cancel-order';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a base event for the demo exchange (uses query-based auth).
 */
function subEvent(overrides = {}) {
  return buildEvent({
    queryStringParameters: { sub: 'user-123' },
    ...overrides,
  });
}

// ─── getBalance ───────────────────────────────────────────────────────────────

describe('demo getBalance', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 400 when sub query parameter is missing.
   */
  it('should return 400 when sub is missing', async () => {
    const result = await getBalance(buildEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('sub');
  });

  /**
   * Should return 200 with existing balance when user record exists.
   */
  it('should return 200 with existing balance', async () => {
    const balance = { sub: 'user-123', aud: 1000, btc: 0 };
    mockDdbSend.mockResolvedValueOnce({ Item: balance });
    const result = await getBalance(subEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(balance);
  });

  /**
   * Should seed a new balance record and return 200 when user has no record.
   */
  it('should seed balance for new user', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: undefined }) // initial GetCommand
      .mockResolvedValueOnce({})                  // PutCommand (seed)
    const result = await getBalance(subEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.aud).toBe(1000); // DEFAULT_DEMO_BALANCE
    expect(body.btc).toBe(0);
  });
});

// ─── getPairs ─────────────────────────────────────────────────────────────────

describe('demo getPairs', () => {
  /**
   * Should return 200 with the list of demo coins.
   */
  it('should return 200 with demo coins', async () => {
    const result = await getPairs(buildEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.coins).toBeDefined();
    expect(Array.isArray(body.coins)).toBe(true);
    expect(body.coins.length).toBeGreaterThan(0);
    expect(body.coins[0].ticker).toBe('BTC');
  });
});

// ─── placeOrder ───────────────────────────────────────────────────────────────

describe('demo placeOrder', () => {
  const validBody = { sub: 'user-123', pair: 'BTC', side: 'buy', size: 0.01 };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: [], result: { XBTAUD: { c: ['50000'] } } }),
    });
  });

  /**
   * Should return 400 when required fields are missing.
   */
  it('should return 400 when sub is missing', async () => {
    const { sub: _s, ...body } = validBody;
    const result = await placeOrder(buildEvent({ body: JSON.stringify(body) }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Missing required fields');
  });

  /**
   * Should return 400 for invalid side value.
   */
  it('should return 400 for invalid side', async () => {
    const result = await placeOrder(buildEvent({
      body: JSON.stringify({ ...validBody, side: 'hold' }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('side must be');
  });

  /**
   * Should return 400 for non-positive size.
   */
  it('should return 400 for non-positive size', async () => {
    const result = await placeOrder(buildEvent({
      body: JSON.stringify({ ...validBody, size: -1 }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('size must be');
  });

  /**
   * Should return 400 for unsupported trading pair.
   */
  it('should return 400 for unsupported pair', async () => {
    const result = await placeOrder(buildEvent({
      body: JSON.stringify({ ...validBody, pair: 'ETH/USD' }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Unsupported pair');
  });

  /**
   * Should return 502 when Kraken price fetch fails.
   */
  it('should return 502 when Kraken price fetch fails', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { sub: 'user-123', aud: 1000, btc: 0 } });
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await placeOrder(buildEvent({ body: JSON.stringify(validBody) }));
    expect(result.statusCode).toBe(502);
  });

  /**
   * Should return 201 with the filled order on success.
   */
  it('should return 201 with filled order on success', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: { sub: 'user-123', aud: 1000, btc: 0 } }) // ensureBalance Get
      .mockResolvedValue({}); // TransactWrite
    const result = await placeOrder(buildEvent({ body: JSON.stringify(validBody) }));
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.side).toBe('buy');
    expect(body.status).toBe('filled');
    expect(body.orderId).toBeDefined();
  });

  /**
   * Should return 200 with a failed order record on insufficient balance (TransactionCanceledException).
   */
  it('should return 200 with failed order on insufficient balance', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: { sub: 'user-123', aud: 1, btc: 0 } }) // ensureBalance Get
      .mockRejectedValueOnce(Object.assign(new Error('Transaction cancelled'), { name: 'TransactionCanceledException' })) // TransactWrite
      .mockResolvedValueOnce({}); // PutCommand for failed order
    const result = await placeOrder(buildEvent({ body: JSON.stringify(validBody) }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('failed');
    expect(body.failReason).toContain('Insufficient');
    expect(body.orderId).toBeDefined();
    expect(body.side).toBe('buy');
  });
});

// ─── listOrders ───────────────────────────────────────────────────────────────

describe('demo listOrders', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 400 when sub is missing.
   */
  it('should return 400 when sub is missing', async () => {
    const result = await listOrders(buildEvent());
    expect(result.statusCode).toBe(400);
  });

  /**
   * Should return 200 with orders on success.
   */
  it('should return 200 with orders on success', async () => {
    const orders = [{ orderId: 'o1', pair: 'BTC' }];
    mockDdbSend.mockResolvedValueOnce({ Items: orders });
    const result = await listOrders(subEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ orders });
  });
});

// ─── cancelOrder ─────────────────────────────────────────────────────────────

describe('demo cancelOrder', () => {
  /**
   * Should return 400 when sub is missing.
   */
  it('should return 400 when sub is missing', async () => {
    const result = await cancelOrder(buildEvent({ pathParameters: { orderId: 'o1' } }));
    expect(result.statusCode).toBe(400);
  });

  /**
   * Should return 400 when orderId is missing.
   */
  it('should return 400 when orderId is missing', async () => {
    const result = await cancelOrder(buildEvent({ queryStringParameters: { sub: 'user-123' } }));
    expect(result.statusCode).toBe(400);
  });

  /**
   * Should return 501 as order cancellation is not supported for demo market orders.
   */
  it('should return 501 indicating cancellation is not supported', async () => {
    const result = await cancelOrder(buildEvent({
      queryStringParameters: { sub: 'user-123' },
      pathParameters: { orderId: 'o1' },
    }));
    expect(result.statusCode).toBe(501);
    expect(JSON.parse(result.body).error).toContain('not supported');
  });
});
