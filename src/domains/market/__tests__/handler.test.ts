import { handler } from '../index';
import { buildEvent } from '../../test-utils';

jest.mock('../routes/get-price-history', () => ({
  getPriceHistory: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"items":[]}' }),
}));

import { getPriceHistory } from '../routes/get-price-history';

describe('market handler', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should dispatch GET /market/prices/{pair} to getPriceHistory.
   */
  it('should dispatch GET /market/prices/{pair} to getPriceHistory', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/market/prices/{pair}' });
    await handler(event);
    expect(getPriceHistory).toHaveBeenCalledWith(event);
  });

  /**
   * Should return 404 for unknown routes.
   */
  it('should return 404 for unknown routes', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/unknown' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
