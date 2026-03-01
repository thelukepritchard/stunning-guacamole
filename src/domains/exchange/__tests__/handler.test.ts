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
jest.mock('../routes/create-connection', () => ({
  createConnection: jest.fn().mockResolvedValue({ statusCode: 201, headers: {}, body: '{}' }),
}));
jest.mock('../routes/list-connections', () => ({
  listConnections: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/delete-connection', () => ({
  deleteConnection: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/set-active-exchange', () => ({
  setActiveExchange: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/get-active-exchange', () => ({
  getActiveExchange: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));

import { getBalance } from '../routes/get-balance';
import { getPairs } from '../routes/get-pairs';
import { listOrders } from '../routes/list-orders';
import { cancelOrder } from '../routes/cancel-order';
import { createConnection } from '../routes/create-connection';
import { listConnections } from '../routes/list-connections';
import { deleteConnection } from '../routes/delete-connection';
import { setActiveExchange } from '../routes/set-active-exchange';
import { getActiveExchange } from '../routes/get-active-exchange';

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
   * Should dispatch POST /exchange/connections to createConnection.
   */
  it('should dispatch POST /exchange/connections to createConnection', async () => {
    const event = buildEvent({ httpMethod: 'POST', resource: '/exchange/connections' });
    await handler(event);
    expect(createConnection).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /exchange/connections to listConnections.
   */
  it('should dispatch GET /exchange/connections to listConnections', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/exchange/connections' });
    await handler(event);
    expect(listConnections).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch DELETE /exchange/connections/{connectionId} to deleteConnection.
   */
  it('should dispatch DELETE /exchange/connections/{connectionId} to deleteConnection', async () => {
    const event = buildEvent({ httpMethod: 'DELETE', resource: '/exchange/connections/{connectionId}' });
    await handler(event);
    expect(deleteConnection).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch PUT /exchange/active to setActiveExchange.
   */
  it('should dispatch PUT /exchange/active to setActiveExchange', async () => {
    const event = buildEvent({ httpMethod: 'PUT', resource: '/exchange/active' });
    await handler(event);
    expect(setActiveExchange).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /exchange/active to getActiveExchange.
   */
  it('should dispatch GET /exchange/active to getActiveExchange', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/exchange/active' });
    await handler(event);
    expect(getActiveExchange).toHaveBeenCalledWith(event);
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
