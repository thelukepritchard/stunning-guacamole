import { buildEvent } from '../../test-utils';
import { listOrders } from '../routes/list-orders';
import { placeOrder } from '../routes/place-order';
import { getOrder } from '../routes/get-order';
import { updateOrder } from '../routes/update-order';
import { cancelOrder } from '../routes/cancel-order';

describe('listOrders', () => {
  it('returns 200 with an items array', async () => {
    const result = await listOrders(buildEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.items).toBeInstanceOf(Array);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('includes expected fields on each item', async () => {
    const result = await listOrders(buildEvent());
    const body = JSON.parse(result.body);

    for (const item of body.items) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('symbol');
      expect(item).toHaveProperty('side');
      expect(item).toHaveProperty('quantity');
      expect(item).toHaveProperty('status');
    }
  });
});

describe('placeOrder', () => {
  it('returns 201 with the created order', async () => {
    const result = await placeOrder(buildEvent({
      body: JSON.stringify({ symbol: 'GOOG', side: 'sell', quantity: 3 }),
    }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body).toEqual({
      id: 'o-new',
      symbol: 'GOOG',
      side: 'sell',
      quantity: 3,
      status: 'pending',
    });
  });

  it('applies defaults when body is empty', async () => {
    const result = await placeOrder(buildEvent({ body: null }));
    const body = JSON.parse(result.body);

    expect(body.symbol).toBe('UNKNOWN');
    expect(body.side).toBe('buy');
    expect(body.quantity).toBe(0);
    expect(body.status).toBe('pending');
  });
});

describe('getOrder', () => {
  it('returns 200 with the order for the given ID', async () => {
    const result = await getOrder(buildEvent({
      pathParameters: { id: 'o-123' },
    }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.id).toBe('o-123');
    expect(body).toHaveProperty('symbol');
    expect(body).toHaveProperty('side');
    expect(body).toHaveProperty('quantity');
    expect(body).toHaveProperty('status');
  });
});

describe('updateOrder', () => {
  it('returns 200 with the updated order', async () => {
    const result = await updateOrder(buildEvent({
      pathParameters: { id: 'o-123' },
      body: JSON.stringify({ status: 'filled' }),
    }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body).toEqual({ id: 'o-123', status: 'filled' });
  });

  it('defaults status when body has no status field', async () => {
    const result = await updateOrder(buildEvent({
      pathParameters: { id: 'o-123' },
      body: null,
    }));
    const body = JSON.parse(result.body);

    expect(body.status).toBe('updated');
  });
});

describe('cancelOrder', () => {
  it('returns 200 with cancelled status', async () => {
    const result = await cancelOrder(buildEvent({
      pathParameters: { id: 'o-123' },
    }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body).toEqual({ id: 'o-123', status: 'cancelled' });
  });
});
