import { handler } from '../index';
import { buildEvent } from '../../test-utils';

jest.mock('../routes/submit-backtest', () => ({
  submitBacktest: jest.fn().mockResolvedValue({ statusCode: 202, headers: {}, body: '{}' }),
}));
jest.mock('../routes/list-backtests', () => ({
  listBacktests: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '[]' }),
}));
jest.mock('../routes/get-latest-backtest', () => ({
  getLatestBacktest: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/get-backtest', () => ({
  getBacktest: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));

import { submitBacktest } from '../routes/submit-backtest';
import { listBacktests } from '../routes/list-backtests';
import { getLatestBacktest } from '../routes/get-latest-backtest';
import { getBacktest } from '../routes/get-backtest';

describe('backtesting handler', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should dispatch POST /backtests/{botId} to submitBacktest.
   */
  it('should dispatch POST /backtests/{botId} to submitBacktest', async () => {
    const event = buildEvent({ httpMethod: 'POST', resource: '/backtests/{botId}' });
    await handler(event);
    expect(submitBacktest).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /backtests/{botId} to listBacktests.
   */
  it('should dispatch GET /backtests/{botId} to listBacktests', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/backtests/{botId}' });
    await handler(event);
    expect(listBacktests).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /backtests/{botId}/latest to getLatestBacktest.
   */
  it('should dispatch GET /backtests/{botId}/latest to getLatestBacktest', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/backtests/{botId}/latest' });
    await handler(event);
    expect(getLatestBacktest).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /backtests/{botId}/{backtestId} to getBacktest.
   */
  it('should dispatch GET /backtests/{botId}/{backtestId} to getBacktest', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/backtests/{botId}/{backtestId}' });
    await handler(event);
    expect(getBacktest).toHaveBeenCalledWith(event);
  });

  /**
   * Should return 404 for unknown routes.
   */
  it('should return 404 for unknown routes', async () => {
    const event = buildEvent({ httpMethod: 'DELETE', resource: '/backtests/{botId}' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
