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

import { handler } from '../index';
import { buildEvent } from '../../test-utils';

beforeEach(() => {
  jest.resetAllMocks();
  process.env.BALANCES_TABLE_NAME = 'BalancesTable';
  process.env.ORDERS_TABLE_NAME = 'OrdersTable';
});

describe('demo-exchange handler', () => {
  /** Verifies GET /demo-exchange/balance routes to getBalance. */
  it('routes GET /demo-exchange/balance to getBalance', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { sub: 'u1', usd: 1000, btc: 0, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    });

    const result = await handler(buildEvent({
      httpMethod: 'GET',
      resource: '/demo-exchange/balance',
      queryStringParameters: { sub: 'u1' },
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).usd).toBe(1000);
  });

  /** Verifies GET /demo-exchange/pairs routes to getPairs. */
  it('routes GET /demo-exchange/pairs to getPairs', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'GET',
      resource: '/demo-exchange/pairs',
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).pairs).toHaveLength(1);
  });

  /** Verifies GET /demo-exchange/orders routes to listOrders. */
  it('routes GET /demo-exchange/orders to listOrders', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(buildEvent({
      httpMethod: 'GET',
      resource: '/demo-exchange/orders',
      queryStringParameters: { sub: 'u1' },
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).orders).toEqual([]);
  });

  /** Verifies DELETE /demo-exchange/orders/{orderId} returns 501. */
  it('routes DELETE /demo-exchange/orders/{orderId} to cancelOrder', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'DELETE',
      resource: '/demo-exchange/orders/{orderId}',
      pathParameters: { orderId: 'o1' },
      queryStringParameters: { sub: 'u1' },
    }));

    expect(result.statusCode).toBe(501);
  });

  /** Verifies unknown routes return 404. */
  it('returns 404 for unknown routes', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'PATCH',
      resource: '/demo-exchange/balance',
    }));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
