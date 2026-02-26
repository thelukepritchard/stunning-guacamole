import { handler } from '../index';
import { buildEvent } from '../../test-utils';

jest.mock('../routes/get-portfolio-performance', () => ({
  getPortfolioPerformance: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/get-bot-performance', () => ({
  getBotPerformance: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/get-leaderboard', () => ({
  getLeaderboard: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/get-trader-profile', () => ({
  getTraderProfile: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));

import { getPortfolioPerformance } from '../routes/get-portfolio-performance';
import { getBotPerformance } from '../routes/get-bot-performance';
import { getLeaderboard } from '../routes/get-leaderboard';
import { getTraderProfile } from '../routes/get-trader-profile';

describe('analytics handler', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should dispatch GET /analytics/performance to getPortfolioPerformance.
   */
  it('should dispatch GET /analytics/performance to getPortfolioPerformance', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/analytics/performance' });
    await handler(event);
    expect(getPortfolioPerformance).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /analytics/bots/{botId}/performance to getBotPerformance.
   */
  it('should dispatch GET /analytics/bots/{botId}/performance to getBotPerformance', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/analytics/bots/{botId}/performance' });
    await handler(event);
    expect(getBotPerformance).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /analytics/leaderboard to getLeaderboard.
   */
  it('should dispatch GET /analytics/leaderboard to getLeaderboard', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/analytics/leaderboard' });
    await handler(event);
    expect(getLeaderboard).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /analytics/leaderboard/{username} to getTraderProfile.
   */
  it('should dispatch GET /analytics/leaderboard/{username} to getTraderProfile', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/analytics/leaderboard/{username}' });
    await handler(event);
    expect(getTraderProfile).toHaveBeenCalledWith(event);
  });

  /**
   * Should return 404 for unknown routes.
   */
  it('should return 404 for unknown routes', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/analytics/unknown' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
