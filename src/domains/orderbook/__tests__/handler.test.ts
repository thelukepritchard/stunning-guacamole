import { handler } from '../index';
import { buildEvent } from '../../test-utils';

describe('orderbook handler', () => {
  it('routes GET /orderbook to listOrders', async () => {
    const result = await handler(buildEvent({ httpMethod: 'GET', resource: '/orderbook' }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).items).toHaveLength(2);
  });

  it('routes POST /orderbook to placeOrder', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'POST',
      resource: '/orderbook',
      body: JSON.stringify({ symbol: 'GOOG', side: 'buy', quantity: 5 }),
    }));

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).symbol).toBe('GOOG');
  });

  it('routes GET /orderbook/{id} to getOrder', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'GET',
      resource: '/orderbook/{id}',
      pathParameters: { id: 'o-001' },
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).id).toBe('o-001');
  });

  it('routes PUT /orderbook/{id} to updateOrder', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'PUT',
      resource: '/orderbook/{id}',
      pathParameters: { id: 'o-001' },
      body: JSON.stringify({ status: 'filled' }),
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ id: 'o-001', status: 'filled' });
  });

  it('routes DELETE /orderbook/{id} to cancelOrder', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'DELETE',
      resource: '/orderbook/{id}',
      pathParameters: { id: 'o-001' },
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ id: 'o-001', status: 'cancelled' });
  });

  it('returns 404 for unknown routes', async () => {
    const result = await handler(buildEvent({ httpMethod: 'PATCH', resource: '/orderbook' }));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
