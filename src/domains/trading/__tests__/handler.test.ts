import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** Mock return for route handlers. */
const mockResponse: APIGatewayProxyResult = {
  statusCode: 200,
  body: JSON.stringify({ ok: true }),
};

const mockListBots = jest.fn().mockResolvedValue(mockResponse);
const mockCreateBot = jest.fn().mockResolvedValue(mockResponse);
const mockGetBot = jest.fn().mockResolvedValue(mockResponse);
const mockUpdateBot = jest.fn().mockResolvedValue(mockResponse);
const mockDeleteBot = jest.fn().mockResolvedValue(mockResponse);
const mockListTrades = jest.fn().mockResolvedValue(mockResponse);
const mockListBotTrades = jest.fn().mockResolvedValue(mockResponse);
const mockGetSettings = jest.fn().mockResolvedValue(mockResponse);
const mockUpdateSettings = jest.fn().mockResolvedValue(mockResponse);
const mockGetExchangeOptions = jest.fn().mockResolvedValue(mockResponse);
const mockSubmitBacktest = jest.fn().mockResolvedValue(mockResponse);
const mockListBacktests = jest.fn().mockResolvedValue(mockResponse);
const mockGetLatestBacktest = jest.fn().mockResolvedValue(mockResponse);
const mockGetBacktest = jest.fn().mockResolvedValue(mockResponse);

jest.mock('../routes/list-bots', () => ({ listBots: mockListBots }));
jest.mock('../routes/create-bot', () => ({ createBot: mockCreateBot }));
jest.mock('../routes/get-bot', () => ({ getBot: mockGetBot }));
jest.mock('../routes/update-bot', () => ({ updateBot: mockUpdateBot }));
jest.mock('../routes/delete-bot', () => ({ deleteBot: mockDeleteBot }));
jest.mock('../routes/list-trades', () => ({ listTrades: mockListTrades }));
jest.mock('../routes/list-bot-trades', () => ({ listBotTrades: mockListBotTrades }));
jest.mock('../routes/get-settings', () => ({ getSettings: mockGetSettings }));
jest.mock('../routes/update-settings', () => ({ updateSettings: mockUpdateSettings }));
jest.mock('../routes/get-exchange-options', () => ({ getExchangeOptions: mockGetExchangeOptions }));
jest.mock('../routes/submit-backtest', () => ({ submitBacktest: mockSubmitBacktest }));
jest.mock('../routes/list-backtests', () => ({ listBacktests: mockListBacktests }));
jest.mock('../routes/get-latest-backtest', () => ({ getLatestBacktest: mockGetLatestBacktest }));
jest.mock('../routes/get-backtest', () => ({ getBacktest: mockGetBacktest }));

import { handler } from '../index';
import { buildEvent } from '../../test-utils';

/**
 * Tests for the trading domain Lambda handler route dispatch.
 * Verifies that each HTTP method + resource combination is routed
 * to the correct route handler, and that unknown routes return 404.
 */
describe('trading handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Verifies GET /trading/bots dispatches to listBots. */
  it('routes GET /trading/bots to listBots', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/trading/bots' });

    const result = await handler(event);

    expect(mockListBots).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies POST /trading/bots dispatches to createBot. */
  it('routes POST /trading/bots to createBot', async () => {
    const event = buildEvent({ httpMethod: 'POST', resource: '/trading/bots' });

    const result = await handler(event);

    expect(mockCreateBot).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies GET /trading/bots/{botId} dispatches to getBot. */
  it('routes GET /trading/bots/{botId} to getBot', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/trading/bots/{botId}',
      pathParameters: { botId: 'bot-001' },
    });

    const result = await handler(event);

    expect(mockGetBot).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies PUT /trading/bots/{botId} dispatches to updateBot. */
  it('routes PUT /trading/bots/{botId} to updateBot', async () => {
    const event = buildEvent({
      httpMethod: 'PUT',
      resource: '/trading/bots/{botId}',
      pathParameters: { botId: 'bot-001' },
    });

    const result = await handler(event);

    expect(mockUpdateBot).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies DELETE /trading/bots/{botId} dispatches to deleteBot. */
  it('routes DELETE /trading/bots/{botId} to deleteBot', async () => {
    const event = buildEvent({
      httpMethod: 'DELETE',
      resource: '/trading/bots/{botId}',
      pathParameters: { botId: 'bot-001' },
    });

    const result = await handler(event);

    expect(mockDeleteBot).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies GET /trading/trades dispatches to listTrades. */
  it('routes GET /trading/trades to listTrades', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/trading/trades' });

    const result = await handler(event);

    expect(mockListTrades).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies GET /trading/trades/{botId} dispatches to listBotTrades. */
  it('routes GET /trading/trades/{botId} to listBotTrades', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/trading/trades/{botId}',
      pathParameters: { botId: 'bot-001' },
    });

    const result = await handler(event);

    expect(mockListBotTrades).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies GET /trading/settings dispatches to getSettings. */
  it('routes GET /trading/settings to getSettings', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/trading/settings' });

    const result = await handler(event);

    expect(mockGetSettings).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies PUT /trading/settings dispatches to updateSettings. */
  it('routes PUT /trading/settings to updateSettings', async () => {
    const event = buildEvent({ httpMethod: 'PUT', resource: '/trading/settings' });

    const result = await handler(event);

    expect(mockUpdateSettings).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies GET /trading/settings/exchange-options dispatches to getExchangeOptions. */
  it('routes GET /trading/settings/exchange-options to getExchangeOptions', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/trading/settings/exchange-options' });

    const result = await handler(event);

    expect(mockGetExchangeOptions).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies POST /trading/bots/{botId}/backtests dispatches to submitBacktest. */
  it('routes POST /trading/bots/{botId}/backtests to submitBacktest', async () => {
    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/trading/bots/{botId}/backtests',
      pathParameters: { botId: 'bot-001' },
    });

    const result = await handler(event);

    expect(mockSubmitBacktest).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies GET /trading/bots/{botId}/backtests dispatches to listBacktests. */
  it('routes GET /trading/bots/{botId}/backtests to listBacktests', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/trading/bots/{botId}/backtests',
      pathParameters: { botId: 'bot-001' },
    });

    const result = await handler(event);

    expect(mockListBacktests).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies GET /trading/bots/{botId}/backtests/latest dispatches to getLatestBacktest. */
  it('routes GET /trading/bots/{botId}/backtests/latest to getLatestBacktest', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/trading/bots/{botId}/backtests/latest',
      pathParameters: { botId: 'bot-001' },
    });

    const result = await handler(event);

    expect(mockGetLatestBacktest).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies GET /trading/bots/{botId}/backtests/{backtestId} dispatches to getBacktest. */
  it('routes GET /trading/bots/{botId}/backtests/{backtestId} to getBacktest', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/trading/bots/{botId}/backtests/{backtestId}',
      pathParameters: { botId: 'bot-001', backtestId: 'bt-001' },
    });

    const result = await handler(event);

    expect(mockGetBacktest).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies that an unknown route returns a 404 response. */
  it('returns 404 for unknown routes', async () => {
    const event = buildEvent({ httpMethod: 'PATCH', resource: '/trading/unknown' });

    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
