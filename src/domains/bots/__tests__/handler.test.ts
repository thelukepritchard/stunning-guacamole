import { handler } from '../index';
import { buildEvent } from '../../test-utils';

// ─── Mock all route handlers ──────────────────────────────────────────────────

jest.mock('../routes/list-bots', () => ({
  listBots: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"items":[]}' }),
}));
jest.mock('../routes/create-bot', () => ({
  createBot: jest.fn().mockResolvedValue({ statusCode: 201, headers: {}, body: '{}' }),
}));
jest.mock('../routes/get-bot', () => ({
  getBot: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/update-bot', () => ({
  updateBot: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/delete-bot', () => ({
  deleteBot: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/get-settings', () => ({
  getSettings: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/update-settings', () => ({
  updateSettings: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
jest.mock('../routes/get-exchange-options', () => ({
  getExchangeOptions: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));

import { listBots } from '../routes/list-bots';
import { createBot } from '../routes/create-bot';
import { getBot } from '../routes/get-bot';
import { updateBot } from '../routes/update-bot';
import { deleteBot } from '../routes/delete-bot';
import { getSettings } from '../routes/get-settings';
import { updateSettings } from '../routes/update-settings';
import { getExchangeOptions } from '../routes/get-exchange-options';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('bots handler', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should dispatch GET /bots to listBots.
   */
  it('should dispatch GET /bots to listBots', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/bots' });
    await handler(event);
    expect(listBots).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch POST /bots to createBot.
   */
  it('should dispatch POST /bots to createBot', async () => {
    const event = buildEvent({ httpMethod: 'POST', resource: '/bots' });
    await handler(event);
    expect(createBot).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /bots/{botId} to getBot.
   */
  it('should dispatch GET /bots/{botId} to getBot', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/bots/{botId}' });
    await handler(event);
    expect(getBot).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch PUT /bots/{botId} to updateBot.
   */
  it('should dispatch PUT /bots/{botId} to updateBot', async () => {
    const event = buildEvent({ httpMethod: 'PUT', resource: '/bots/{botId}' });
    await handler(event);
    expect(updateBot).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch DELETE /bots/{botId} to deleteBot.
   */
  it('should dispatch DELETE /bots/{botId} to deleteBot', async () => {
    const event = buildEvent({ httpMethod: 'DELETE', resource: '/bots/{botId}' });
    await handler(event);
    expect(deleteBot).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /settings to getSettings.
   */
  it('should dispatch GET /settings to getSettings', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/settings' });
    await handler(event);
    expect(getSettings).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch PUT /settings to updateSettings.
   */
  it('should dispatch PUT /settings to updateSettings', async () => {
    const event = buildEvent({ httpMethod: 'PUT', resource: '/settings' });
    await handler(event);
    expect(updateSettings).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch GET /settings/exchange-options to getExchangeOptions.
   */
  it('should dispatch GET /settings/exchange-options to getExchangeOptions', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/settings/exchange-options' });
    await handler(event);
    expect(getExchangeOptions).toHaveBeenCalledWith(event);
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
