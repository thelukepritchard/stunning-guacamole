import { handler } from '../index';
import { buildEvent } from '../../test-utils';

jest.mock('../routes/list-trades', () => ({
  listTrades: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"items":[]}' }),
}));
jest.mock('../routes/list-bot-trades', () => ({
  listBotTrades: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"items":[]}' }),
}));

import { listTrades } from '../routes/list-trades';
import { listBotTrades } from '../routes/list-bot-trades';

describe('executor handler', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should dispatch GET /trades to listTrades.
   */
  it('should dispatch GET /trades to listTrades', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/trades' });
    await handler(event);
    expect(listTrades).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /trades/{botId} to listBotTrades.
   */
  it('should dispatch GET /trades/{botId} to listBotTrades', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/trades/{botId}' });
    await handler(event);
    expect(listBotTrades).toHaveBeenCalledWith(event);
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
