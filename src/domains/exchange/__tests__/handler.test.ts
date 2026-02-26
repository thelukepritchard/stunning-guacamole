import { handler } from '../index';
import { buildEvent } from '../../test-utils';

jest.mock('../routes/get-balance', () => ({
  getBalance: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/get-pairs', () => ({
  getPairs: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/list-orders', () => ({
  listOrders: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/cancel-order', () => ({
  cancelOrder: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));

import { getBalance } from '../routes/get-balance';
import { getPairs } from '../routes/get-pairs';
import { listOrders } from '../routes/list-orders';
import { cancelOrder } from '../routes/cancel-order';

describe('exchange handler', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should dispatch GET /exchange/balance to getBalance.
   */
  it('should dispatch GET /exchange/balance to getBalance', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/exchange/balance' });
    await handler(event);
    expect(getBalance).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /exchange/pairs to getPairs.
   */
  it('should dispatch GET /exchange/pairs to getPairs', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/exchange/pairs' });
    await handler(event);
    expect(getPairs).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /exchange/orders to listOrders.
   */
  it('should dispatch GET /exchange/orders to listOrders', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/exchange/orders' });
    await handler(event);
    expect(listOrders).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch DELETE /exchange/orders/{orderId} to cancelOrder.
   */
  it('should dispatch DELETE /exchange/orders/{orderId} to cancelOrder', async () => {
    const event = buildEvent({ httpMethod: 'DELETE', resource: '/exchange/orders/{orderId}' });
    await handler(event);
    expect(cancelOrder).toHaveBeenCalledWith(event);
  });

  /**
   * Should return 404 for unknown routes.
   */
  it('should return 404 for unknown routes', async () => {
    const event = buildEvent({ httpMethod: 'POST', resource: '/exchange/unknown' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
