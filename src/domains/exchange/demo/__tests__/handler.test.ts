import { handler } from '../index';
import { buildEvent } from '../../../test-utils';

jest.mock('../routes/get-balance', () => ({
  getBalance: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/get-pairs', () => ({
  getPairs: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/place-order', () => ({
  placeOrder: jest.fn().mockResolvedValue({ statusCode: 201, headers: {}, body: '{}' }),
}));
jest.mock('../routes/list-orders', () => ({
  listOrders: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/cancel-order', () => ({
  cancelOrder: jest.fn().mockResolvedValue({ statusCode: 501, headers: {}, body: '{}' }),
}));

import { getBalance } from '../routes/get-balance';
import { getPairs } from '../routes/get-pairs';
import { placeOrder } from '../routes/place-order';
import { listOrders } from '../routes/list-orders';
import { cancelOrder } from '../routes/cancel-order';

describe('demo exchange handler', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should dispatch GET /demo-exchange/balance to getBalance.
   */
  it('should dispatch GET /demo-exchange/balance to getBalance', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/demo-exchange/balance' });
    await handler(event);
    expect(getBalance).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /demo-exchange/pairs to getPairs.
   */
  it('should dispatch GET /demo-exchange/pairs to getPairs', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/demo-exchange/pairs' });
    await handler(event);
    expect(getPairs).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch POST /demo-exchange/orders to placeOrder.
   */
  it('should dispatch POST /demo-exchange/orders to placeOrder', async () => {
    const event = buildEvent({ httpMethod: 'POST', resource: '/demo-exchange/orders' });
    await handler(event);
    expect(placeOrder).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /demo-exchange/orders to listOrders.
   */
  it('should dispatch GET /demo-exchange/orders to listOrders', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/demo-exchange/orders' });
    await handler(event);
    expect(listOrders).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch DELETE /demo-exchange/orders/{orderId} to cancelOrder.
   */
  it('should dispatch DELETE /demo-exchange/orders/{orderId} to cancelOrder', async () => {
    const event = buildEvent({ httpMethod: 'DELETE', resource: '/demo-exchange/orders/{orderId}' });
    await handler(event);
    expect(cancelOrder).toHaveBeenCalledWith(event);
  });

  /**
   * Should return 404 for unknown routes.
   */
  it('should return 404 for unknown routes', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/demo-exchange/unknown' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
