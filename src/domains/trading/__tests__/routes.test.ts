import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockSend = jest.fn();
const mockEventBridgeSend = jest.fn();
const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  PutCommand: jest.fn((params) => ({ ...params, _type: 'Put' })),
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
  GetCommand: jest.fn((params) => ({ ...params, _type: 'Get' })),
  UpdateCommand: jest.fn((params) => ({ ...params, _type: 'Update' })),
  DeleteCommand: jest.fn((params) => ({ ...params, _type: 'Delete' })),
  BatchWriteCommand: jest.fn((params) => ({ ...params, _type: 'BatchWrite' })),
}));
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn((params) => ({ ...params, _type: 'PutEvents' })),
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  DeleteObjectCommand: jest.fn((params) => ({ ...params, _type: 'DeleteObject' })),
}));

import { createBot } from '../routes/create-bot';
import { listBots } from '../routes/list-bots';
import { getBot } from '../routes/get-bot';
import { updateBot } from '../routes/update-bot';
import { deleteBot } from '../routes/delete-bot';
import { listTrades } from '../routes/list-trades';
import { listBotTrades } from '../routes/list-bot-trades';
import { getPriceHistory } from '../routes/get-price-history';

/**
 * Builds a mock API Gateway proxy event for route handler tests.
 *
 * @param overrides - Partial event properties to merge into the defaults.
 * @returns A fully-formed mock API Gateway proxy event.
 */
function buildRouteEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    resource: '/trading/bots',
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: '/trading/bots',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      authorizer: { claims: { sub: 'user-123' } },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  };
}

/**
 * Tests for all trading domain route handlers.
 * Each handler is tested with mocked DynamoDB and EventBridge calls.
 */
describe('trading route handlers', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.BOTS_TABLE_NAME = 'BotsTable';
    process.env.TRADES_TABLE_NAME = 'TradesTable';
    process.env.BOT_PERFORMANCE_TABLE_NAME = 'BotPerformanceTable';
    process.env.BACKTESTS_TABLE_NAME = 'BacktestsTable';
    process.env.BACKTEST_REPORTS_BUCKET = 'backtest-reports-bucket';
    process.env.PRICE_HISTORY_TABLE_NAME = 'PriceHistoryTable';
  });

  /**
   * Tests for the createBot route handler.
   */
  describe('createBot', () => {
    /** Verifies a valid request with buyQuery creates a bot and returns 201. */
    it('returns 201 with the created bot for a valid body with buyQuery', async () => {
      mockSend.mockResolvedValueOnce({}); // PutCommand
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({
          name: 'Test Bot',
          pair: 'BTC/USDT',
          executionMode: 'condition_cooldown',
          buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
          buySizing: { type: 'fixed', value: 100 },
        }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(body.name).toBe('Test Bot');
      expect(body.pair).toBe('BTC/USDT');
      expect(body.executionMode).toBe('condition_cooldown');
      expect(body.buyQuery).toBeDefined();
      expect(body.buySizing).toBeDefined();
      expect(body.sellQuery).toBeUndefined();
      expect(body.status).toBe('draft');
      expect(body.botId).toBeDefined();
      expect(body.sub).toBe('user-123');
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    });

    /** Verifies a BotCreated event is published. */
    it('publishes a BotCreated event to EventBridge', async () => {
      mockSend.mockResolvedValueOnce({}); // PutCommand
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({
          name: 'Test Bot',
          pair: 'BTC/USDT',
          executionMode: 'condition_cooldown',
          buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
          buySizing: { type: 'fixed', value: 100 },
        }),
      });

      await createBot(event);

      const { PutEventsCommand } = require('@aws-sdk/client-eventbridge');
      const ebCall = PutEventsCommand.mock.calls[0][0];
      expect(ebCall.Entries[0].Source).toBe('signalr.trading');
      expect(ebCall.Entries[0].DetailType).toBe('BotCreated');
      const detail = JSON.parse(ebCall.Entries[0].Detail);
      expect(detail.bot.name).toBe('Test Bot');
    });

    /** Verifies a valid request with both buyQuery and sellQuery creates a bot. */
    it('returns 201 with the created bot for both buyQuery and sellQuery', async () => {
      mockSend.mockResolvedValueOnce({}); // PutCommand
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({
          name: 'Full Bot',
          pair: 'ETH/USDT',
          executionMode: 'once_and_wait',
          buyQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '<', value: '30' }] },
          sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '70' }] },
          buySizing: { type: 'fixed', value: 100 },
          sellSizing: { type: 'fixed', value: 100 },
        }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(body.executionMode).toBe('once_and_wait');
      expect(body.buyQuery).toBeDefined();
      expect(body.buySizing).toBeDefined();
      expect(body.sellQuery).toBeDefined();
      expect(body.sellSizing).toBeDefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    /** Verifies missing fields return a 400 error. */
    it('returns 400 when required fields are missing', async () => {
      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({ name: 'Test Bot' }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('Missing required fields');
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });

    /** Verifies no queries returns a 400 error. */
    it('returns 400 when neither buyQuery nor sellQuery is provided', async () => {
      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({ name: 'Test Bot', pair: 'BTC/USDT', executionMode: 'condition_cooldown' }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('buyQuery or sellQuery');
      expect(mockSend).not.toHaveBeenCalled();
    });

    /** Verifies once_and_wait requires both buyQuery and sellQuery. */
    it('returns 400 when once_and_wait is missing sellQuery', async () => {
      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({
          name: 'Test Bot',
          pair: 'BTC/USDT',
          executionMode: 'once_and_wait',
          buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
          buySizing: { type: 'fixed', value: 100 },
        }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('once_and_wait');
      expect(mockSend).not.toHaveBeenCalled();
    });

    /** Verifies once_and_wait requires both buyQuery and sellQuery. */
    it('returns 400 when once_and_wait is missing buyQuery', async () => {
      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({
          name: 'Test Bot',
          pair: 'BTC/USDT',
          executionMode: 'once_and_wait',
          sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '70' }] },
          sellSizing: { type: 'fixed', value: 100 },
        }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('once_and_wait');
      expect(mockSend).not.toHaveBeenCalled();
    });

    /** Verifies a bot with cooldownMinutes is created correctly. */
    it('returns 201 with cooldownMinutes for condition_cooldown bot', async () => {
      mockSend.mockResolvedValueOnce({}); // PutCommand
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({
          name: 'Cooldown Bot',
          pair: 'BTC/USDT',
          executionMode: 'condition_cooldown',
          buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
          buySizing: { type: 'fixed', value: 100 },
          cooldownMinutes: 30,
        }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(body.buySizing).toBeDefined();
      expect(body.cooldownMinutes).toBe(30);
    });

    /** Verifies negative cooldownMinutes returns 400. */
    it('returns 400 when cooldownMinutes is negative', async () => {
      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({
          name: 'Bad Bot',
          pair: 'BTC/USDT',
          executionMode: 'condition_cooldown',
          buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
          buySizing: { type: 'fixed', value: 100 },
          cooldownMinutes: -5,
        }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('cooldownMinutes');
    });

    /** Verifies invalid executionMode returns 400. */
    it('returns 400 when executionMode is invalid', async () => {
      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({
          name: 'Test Bot',
          pair: 'BTC/USDT',
          executionMode: 'invalid_mode',
          buyQuery: { combinator: 'and', rules: [] },
          buySizing: { type: 'fixed', value: 100 },
        }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('executionMode');
      expect(mockSend).not.toHaveBeenCalled();
    });

    /** Verifies missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({
          name: 'Test Bot',
          pair: 'BTC/USDT',
          executionMode: 'condition_cooldown',
          buyQuery: { combinator: 'and', rules: [] },
          buySizing: { type: 'fixed', value: 100 },
        }),
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });
  });

  /**
   * Tests for the listBots route handler.
   */
  describe('listBots', () => {
    /** Verifies items are returned from a DynamoDB query. */
    it('returns 200 with items from DynamoDB query', async () => {
      const mockItems = [
        { botId: 'bot-1', name: 'Bot 1', sub: 'user-123' },
        { botId: 'bot-2', name: 'Bot 2', sub: 'user-123' },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/bots',
      });

      const result = await listBots(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toEqual(mockItems);
      expect(body.items).toHaveLength(2);
    });

    /** Verifies empty result returns an empty array. */
    it('returns 200 with empty array when no bots exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/bots',
      });

      const result = await listBots(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toEqual([]);
    });

    /** Verifies missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await listBots(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });
  });

  /**
   * Tests for the getBot route handler.
   */
  describe('getBot', () => {
    /** Verifies a found bot returns 200. */
    it('returns 200 with the bot when found', async () => {
      const mockBot = { botId: 'bot-001', name: 'My Bot', sub: 'user-123' };
      mockSend.mockResolvedValueOnce({ Item: mockBot });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
      });

      const result = await getBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body).toEqual(mockBot);
    });

    /** Verifies a missing bot returns 404. */
    it('returns 404 when bot is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'nonexistent' },
      });

      const result = await getBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Bot not found');
    });

    /** Verifies missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await getBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });
  });

  /**
   * Tests for the updateBot route handler.
   */
  describe('updateBot', () => {
    /** Verifies a valid update returns 200 with updated attributes. */
    it('returns 200 with updated attributes for a valid update', async () => {
      const currentBot = { botId: 'bot-001', name: 'Old Name', sub: 'user-123', status: 'draft', executionMode: 'condition_cooldown' };
      const updatedAttrs = { botId: 'bot-001', name: 'Updated Bot', sub: 'user-123', status: 'draft', executionMode: 'condition_cooldown' };
      mockSend.mockResolvedValueOnce({ Item: currentBot }); // GetCommand
      mockSend.mockResolvedValueOnce({ Attributes: updatedAttrs }); // UpdateCommand
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ name: 'Updated Bot' }),
      });

      const result = await updateBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body).toEqual(updatedAttrs);
    });

    /** Verifies no valid fields returns 400. */
    it('returns 400 when no valid fields are provided', async () => {
      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ unknownField: 'value' }),
      });

      const result = await updateBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toBe('No valid fields to update');
      expect(mockSend).not.toHaveBeenCalled();
    });

    /** Verifies 404 when bot is not found via GetCommand. */
    it('returns 404 when bot is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand — not found

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'nonexistent' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      const result = await updateBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Bot not found');
    });

    /** Verifies other DynamoDB errors are re-thrown. */
    it('re-throws non-conditional errors', async () => {
      const currentBot = { botId: 'bot-001', name: 'Old Name', sub: 'user-123', status: 'draft', executionMode: 'condition_cooldown' };
      mockSend.mockResolvedValueOnce({ Item: currentBot }); // GetCommand

      const error = new Error('Internal error');
      (error as unknown as { name: string }).name = 'InternalServerError';
      mockSend.mockRejectedValueOnce(error); // UpdateCommand

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      await expect(updateBot(event)).rejects.toThrow('Internal error');
    });

    /** Verifies switching to once_and_wait fails when bot only has buyQuery. */
    it('returns 400 when switching to once_and_wait without both queries', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          sub: 'user-123', botId: 'bot-001', executionMode: 'condition_cooldown',
          buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
          buySizing: { type: 'fixed', value: 100 },
        },
      }); // GetCommand

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ executionMode: 'once_and_wait' }),
      });

      const result = await updateBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('once_and_wait');
    });

    /** Verifies switching to once_and_wait succeeds when bot has both queries. */
    it('allows switching to once_and_wait when bot has both queries', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          sub: 'user-123', botId: 'bot-001', status: 'draft', executionMode: 'condition_cooldown',
          buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
          buySizing: { type: 'fixed', value: 100 },
          sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '70' }] },
          sellSizing: { type: 'fixed', value: 100 },
        },
      }); // GetCommand
      const updatedAttrs = { botId: 'bot-001', executionMode: 'once_and_wait', sub: 'user-123' };
      mockSend.mockResolvedValueOnce({ Attributes: updatedAttrs }); // UpdateCommand
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ executionMode: 'once_and_wait' }),
      });

      const result = await updateBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.executionMode).toBe('once_and_wait');
    });

    /** Verifies removing sellQuery from a once_and_wait bot is rejected. */
    it('returns 400 when removing sellQuery from once_and_wait bot', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          sub: 'user-123', botId: 'bot-001', executionMode: 'once_and_wait',
          buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
          buySizing: { type: 'fixed', value: 100 },
          sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '70' }] },
          sellSizing: { type: 'fixed', value: 100 },
        },
      }); // GetCommand

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ sellQuery: null }),
      });

      const result = await updateBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('once_and_wait');
    });

    /** Verifies a BotUpdated event is published with previous status. */
    it('publishes a BotUpdated event to EventBridge', async () => {
      const currentBot = { botId: 'bot-001', name: 'Old', sub: 'user-123', status: 'active', executionMode: 'condition_cooldown' };
      const updatedAttrs = { botId: 'bot-001', name: 'Old', sub: 'user-123', status: 'paused', executionMode: 'condition_cooldown' };
      mockSend.mockResolvedValueOnce({ Item: currentBot }); // GetCommand
      mockSend.mockResolvedValueOnce({ Attributes: updatedAttrs }); // UpdateCommand
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ status: 'paused' }),
      });

      await updateBot(event);

      const { PutEventsCommand } = require('@aws-sdk/client-eventbridge');
      const ebCall = PutEventsCommand.mock.calls[0][0];
      expect(ebCall.Entries[0].Source).toBe('signalr.trading');
      expect(ebCall.Entries[0].DetailType).toBe('BotUpdated');
      const detail = JSON.parse(ebCall.Entries[0].Detail);
      expect(detail.previousStatus).toBe('active');
      expect(detail.bot.status).toBe('paused');
    });

    /** Verifies missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ name: 'Updated' }),
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await updateBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });
  });

  /**
   * Tests for the deleteBot route handler.
   */
  describe('deleteBot', () => {
    /** Verifies successful deletion returns 200 and deletes trades. */
    it('returns 200 with deletion confirmation and deletes trades', async () => {
      const mockTrades = [
        { botId: 'bot-001', timestamp: '2026-01-01T00:00:00Z' },
        { botId: 'bot-001', timestamp: '2026-01-01T00:01:00Z' },
      ];
      mockSend.mockResolvedValueOnce({}); // DeleteCommand
      mockSend.mockResolvedValueOnce({ Items: mockTrades }); // trade query
      mockSend.mockResolvedValueOnce({ Items: [] }); // performance query
      mockSend.mockResolvedValueOnce({}); // batch delete (trades)
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'DELETE',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
      });

      const result = await deleteBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body).toEqual({ botId: 'bot-001', deleted: true });
    });

    /** Verifies a BotDeleted event is published. */
    it('publishes a BotDeleted event to EventBridge', async () => {
      mockSend.mockResolvedValueOnce({}); // DeleteCommand
      mockSend.mockResolvedValueOnce({ Items: [] }); // trade query (empty)
      mockSend.mockResolvedValueOnce({ Items: [] }); // performance query (empty)
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'DELETE',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
      });

      await deleteBot(event);

      const { PutEventsCommand } = require('@aws-sdk/client-eventbridge');
      const ebCall = PutEventsCommand.mock.calls[0][0];
      expect(ebCall.Entries[0].DetailType).toBe('BotDeleted');
      const detail = JSON.parse(ebCall.Entries[0].Detail);
      expect(detail.sub).toBe('user-123');
      expect(detail.botId).toBe('bot-001');
    });

    /** Verifies deletion works when bot has no trades. */
    it('handles bot with no trades gracefully', async () => {
      mockSend.mockResolvedValueOnce({}); // DeleteCommand
      mockSend.mockResolvedValueOnce({ Items: [] }); // trade query (empty)
      mockSend.mockResolvedValueOnce({ Items: [] }); // performance query (empty)
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'DELETE',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
      });

      const result = await deleteBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body).toEqual({ botId: 'bot-001', deleted: true });
    });

    /** Verifies BotDeleted event is always published after deletion. */
    it('publishes BotDeleted event after deletion', async () => {
      mockSend.mockResolvedValueOnce({}); // DeleteCommand
      mockSend.mockResolvedValueOnce({ Items: [] }); // trade query
      mockSend.mockResolvedValueOnce({ Items: [] }); // performance query
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'DELETE',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
      });

      await deleteBot(event);

      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    });

    /** Verifies missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        httpMethod: 'DELETE',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await deleteBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    /** Verifies missing botId returns 400. */
    it('returns 400 when botId is missing', async () => {
      const event = buildRouteEvent({
        httpMethod: 'DELETE',
        resource: '/trading/bots/{botId}',
        pathParameters: null,
      });

      const result = await deleteBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toBe('Missing botId');
    });

    /** Verifies backtest S3 objects and DynamoDB records are cleaned up on bot deletion. */
    it('cleans up backtest S3 objects and DDB records when BACKTESTS_TABLE_NAME is set', async () => {
      const backtests = [
        { sub: 'user-123', backtestId: 'bt-001', botId: 'bot-001', s3Key: 'backtests/user-123/bot-001/bt-001.json' },
        { sub: 'user-123', backtestId: 'bt-002', botId: 'bot-001', s3Key: undefined },
      ];
      mockSend.mockResolvedValueOnce({}); // DeleteCommand — bot
      mockSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand — trade query
      mockSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand — performance query
      mockSend.mockResolvedValueOnce({ Items: backtests }); // QueryCommand — backtest query
      mockS3Send.mockResolvedValueOnce({}); // S3 delete for bt-001
      mockSend.mockResolvedValueOnce({}); // DeleteCommand — DDB delete for bt-001
      mockSend.mockResolvedValueOnce({}); // DeleteCommand — DDB delete for bt-002
      mockEventBridgeSend.mockResolvedValueOnce({});

      const event = buildRouteEvent({
        httpMethod: 'DELETE',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
      });

      const result = await deleteBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.deleted).toBe(true);

      // Verify S3 delete was called for the backtest that has an s3Key
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      expect(DeleteObjectCommand).toHaveBeenCalledTimes(1);
      expect(DeleteObjectCommand.mock.calls[0][0].Key).toBe('backtests/user-123/bot-001/bt-001.json');

      // Verify both backtest DDB records were deleted
      const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
      const deleteKeys = DeleteCommand.mock.calls.map((c: [{ Key: unknown }]) => c[0].Key);
      expect(deleteKeys).toContainEqual({ sub: 'user-123', backtestId: 'bt-001' });
      expect(deleteKeys).toContainEqual({ sub: 'user-123', backtestId: 'bt-002' });
    });

    /** Verifies deletion still returns 200 when backtest cleanup fails. */
    it('returns 200 even when backtest cleanup throws', async () => {
      mockSend.mockResolvedValueOnce({}); // DeleteCommand — bot
      mockSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand — trade query
      mockSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand — performance query
      mockSend.mockRejectedValueOnce(new Error('Backtest query failed')); // QueryCommand — backtest query fails
      mockEventBridgeSend.mockResolvedValueOnce({});

      const event = buildRouteEvent({
        httpMethod: 'DELETE',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
      });

      const result = await deleteBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.deleted).toBe(true);
    });
  });

  /**
   * Tests for the updateBot backtest invalidation logic.
   */
  describe('updateBot — backtest invalidation', () => {
    /** Verifies backtests are marked stale when buy/sell queries change. */
    it('marks existing backtests as stale when buyQuery changes', async () => {
      const currentBot = {
        sub: 'user-123', botId: 'bot-001', status: 'active', executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
        buySizing: { type: 'fixed', value: 100 },
      };
      const newBuyQuery = { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '60000' }] };
      const updatedAttrs = {
        ...currentBot,
        buyQuery: newBuyQuery,
      };
      const existingBacktests = [
        { sub: 'user-123', backtestId: 'bt-001', botId: 'bot-001', configChangedSinceTest: false },
        { sub: 'user-123', backtestId: 'bt-002', botId: 'bot-001', configChangedSinceTest: false },
      ];

      mockSend.mockResolvedValueOnce({ Item: currentBot }); // GetCommand
      mockSend.mockResolvedValueOnce({ Attributes: updatedAttrs }); // UpdateCommand — update bot
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge
      mockSend.mockResolvedValueOnce({ Items: existingBacktests }); // QueryCommand — backtest list
      mockSend.mockResolvedValueOnce({}); // UpdateCommand — mark bt-001 stale
      mockSend.mockResolvedValueOnce({}); // UpdateCommand — mark bt-002 stale

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ buyQuery: newBuyQuery }),
      });

      const result = await updateBot(event);
      expect(result.statusCode).toBe(200);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      // Find the calls that update backtests (set configChangedSinceTest = true)
      const stalenessUpdates = UpdateCommand.mock.calls.filter(
        (call: [{ TableName: string }]) => call[0].TableName === 'BacktestsTable',
      );
      expect(stalenessUpdates).toHaveLength(2);
      expect(stalenessUpdates[0][0].ExpressionAttributeValues[':changed']).toBe(true);
    });

    /** Verifies backtests are NOT marked stale when only the bot name changes (not queries). */
    it('does not mark backtests stale when only name is updated (no query change)', async () => {
      const currentBot = {
        sub: 'user-123', botId: 'bot-001', name: 'Old Name', status: 'active', executionMode: 'condition_cooldown',
      };
      const updatedAttrs = { ...currentBot, name: 'New Name' };
      mockSend.mockResolvedValueOnce({ Item: currentBot }); // GetCommand
      mockSend.mockResolvedValueOnce({ Attributes: updatedAttrs }); // UpdateCommand — update bot
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ name: 'New Name' }),
      });

      await updateBot(event);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      const backtestUpdates = UpdateCommand.mock.calls.filter(
        (call: [{ TableName: string }]) => call[0].TableName === 'BacktestsTable',
      );
      expect(backtestUpdates).toHaveLength(0);
    });

    /** Verifies backtests are marked stale when stopLoss is changed (affects SL/TP evaluation). */
    it('marks backtests stale when stopLoss is updated', async () => {
      const currentBot = {
        sub: 'user-123', botId: 'bot-001', status: 'active', executionMode: 'condition_cooldown',
        stopLoss: { percentage: 5 },
      };
      const updatedAttrs = { ...currentBot, stopLoss: { percentage: 10 } };
      const existingBacktests = [
        { sub: 'user-123', backtestId: 'bt-001', botId: 'bot-001' },
      ];

      mockSend.mockResolvedValueOnce({ Item: currentBot }); // GetCommand
      mockSend.mockResolvedValueOnce({ Attributes: updatedAttrs }); // UpdateCommand — bot
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge
      mockSend.mockResolvedValueOnce({ Items: existingBacktests }); // QueryCommand
      mockSend.mockResolvedValueOnce({}); // UpdateCommand — mark stale

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ stopLoss: { percentage: 10 } }),
      });

      const result = await updateBot(event);
      expect(result.statusCode).toBe(200);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      const stalenessUpdates = UpdateCommand.mock.calls.filter(
        (call: [{ TableName: string }]) => call[0].TableName === 'BacktestsTable',
      );
      expect(stalenessUpdates).toHaveLength(1);
    });

    /** Verifies that backtest staleness errors are swallowed and do not fail the update. */
    it('continues when backtest staleness update fails', async () => {
      const currentBot = {
        sub: 'user-123', botId: 'bot-001', status: 'active', executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
        buySizing: { type: 'fixed', value: 100 },
      };
      const newBuyQuery = { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '60000' }] };
      const updatedAttrs = { ...currentBot, buyQuery: newBuyQuery };

      mockSend.mockResolvedValueOnce({ Item: currentBot }); // GetCommand
      mockSend.mockResolvedValueOnce({ Attributes: updatedAttrs }); // UpdateCommand — update bot
      mockEventBridgeSend.mockResolvedValueOnce({}); // EventBridge
      mockSend.mockRejectedValueOnce(new Error('QueryCommand failed')); // backtest query fails

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ buyQuery: newBuyQuery }),
      });

      const result = await updateBot(event);
      // Should still succeed even though backtest invalidation failed
      expect(result.statusCode).toBe(200);
    });
  });

  /**
   * Tests for the listTrades route handler.
   */
  describe('listTrades', () => {
    /** Verifies trades are returned with default limit. */
    it('returns 200 with trade items', async () => {
      const mockTrades = [
        { botId: 'bot-1', timestamp: '2026-01-01T00:00:00Z', action: 'buy' },
        { botId: 'bot-2', timestamp: '2026-01-01T00:01:00Z', action: 'sell' },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockTrades });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/trades',
      });

      const result = await listTrades(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toEqual(mockTrades);
    });

    /** Verifies custom limit is passed to the query. */
    it('respects the limit query parameter', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/trades',
        queryStringParameters: { limit: '10' },
      });

      await listTrades(event);

      // Verify the QueryCommand was called with the correct Limit
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      expect(QueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({ Limit: 10 }),
      );
    });

    /** Verifies missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/trades',
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await listTrades(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });
  });

  /**
   * Tests for the listBotTrades route handler.
   */
  describe('listBotTrades', () => {
    /** Verifies trades are returned when bot is found. */
    it('returns 200 with bot trades when bot exists', async () => {
      const mockBot = { botId: 'bot-001', name: 'My Bot', sub: 'user-123' };
      const mockTrades = [
        { botId: 'bot-001', timestamp: '2026-01-01T00:00:00Z', action: 'buy' },
      ];

      // First call: GetCommand for bot lookup
      mockSend.mockResolvedValueOnce({ Item: mockBot });
      // Second call: QueryCommand for trades
      mockSend.mockResolvedValueOnce({ Items: mockTrades });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/trades/{botId}',
        pathParameters: { botId: 'bot-001' },
      });

      const result = await listBotTrades(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toEqual(mockTrades);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    /** Verifies 404 when bot is not found. */
    it('returns 404 when bot is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/trades/{botId}',
        pathParameters: { botId: 'nonexistent' },
      });

      const result = await listBotTrades(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Bot not found');
      // Should not query trades if bot not found
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    /** Verifies missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/trades/{botId}',
        pathParameters: { botId: 'bot-001' },
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await listBotTrades(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });
  });

  /**
   * Tests for the getPriceHistory route handler, including the normalizePair
   * helper that converts dash-separated and no-separator pair formats to the
   * canonical BASE/QUOTE format used as the DynamoDB partition key.
   */
  describe('getPriceHistory', () => {
    /** Happy path — dash-separated pair (BTC-USDT) is normalised to BTC/USDT. */
    it('returns 200 with price history items for a dash-separated pair', async () => {
      const mockItems = [
        { pair: 'BTC/USDT', timestamp: '2025-01-01T00:00:00.000Z', close: 50000 },
        { pair: 'BTC/USDT', timestamp: '2025-01-01T01:00:00.000Z', close: 51000 },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: { pair: 'BTC-USDT' },
        queryStringParameters: { period: '24h' },
      });

      const result = await getPriceHistory(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toEqual(mockItems);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    /** Normalisation — slash-separated pair (BTC/USDT) is passed through unchanged. */
    it('accepts a slash-separated pair without transformation', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: { pair: 'BTC/USDT' },
        queryStringParameters: { period: '1h' },
      });

      await getPriceHistory(event);

      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      expect(QueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({ ':pair': 'BTC/USDT' }),
        }),
      );
    });

    /** Normalisation — no-separator Binance-style symbol (BTCUSDT) is split into BTC/USDT. */
    it('normalises a no-separator Binance-style pair (BTCUSDT) to BTC/USDT', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: { pair: 'BTCUSDT' },
        queryStringParameters: { period: '1h' },
      });

      await getPriceHistory(event);

      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      expect(QueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({ ':pair': 'BTC/USDT' }),
        }),
      );
    });

    /** Normalisation — ETHUSDT is split into ETH/USDT. */
    it('normalises ETHUSDT to ETH/USDT', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: { pair: 'ETHUSDT' },
        queryStringParameters: { period: '6h' },
      });

      await getPriceHistory(event);

      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      expect(QueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({ ':pair': 'ETH/USDT' }),
        }),
      );
    });

    /** Normalisation — BNBBTC (quote is BTC) is split into BNB/BTC. */
    it('normalises BNBBTC to BNB/BTC using the BTC known-quote entry', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: { pair: 'BNBBTC' },
        queryStringParameters: { period: '1h' },
      });

      await getPriceHistory(event);

      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      expect(QueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({ ':pair': 'BNB/BTC' }),
        }),
      );
    });

    /** Normalisation — dash-separated pair (ETH-USDT) is normalised to ETH/USDT. */
    it('normalises a dash-separated pair (ETH-USDT) to ETH/USDT', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: { pair: 'ETH-USDT' },
        queryStringParameters: { period: '7d' },
      });

      await getPriceHistory(event);

      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      expect(QueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({ ':pair': 'ETH/USDT' }),
        }),
      );
    });

    /** Default period — omitting the period query param uses '24h'. */
    it('defaults to 24h period when period query parameter is absent', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: { pair: 'BTC-USDT' },
        queryStringParameters: null,
      });

      const result = await getPriceHistory(event);

      expect(result.statusCode).toBe(200);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    /** DynamoDB query uses the correct table, key expression, and ScanIndexForward. */
    it('queries DynamoDB with the correct key expression and scan direction', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: { pair: 'BTC-USDT' },
        queryStringParameters: { period: '1h' },
      });

      await getPriceHistory(event);

      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      expect(QueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'PriceHistoryTable',
          KeyConditionExpression: '#pair = :pair AND #ts >= :since',
          ExpressionAttributeNames: { '#pair': 'pair', '#ts': 'timestamp' },
          ScanIndexForward: true,
        }),
      );
    });

    /** Empty result — DynamoDB returning undefined Items is coerced to an empty array. */
    it('returns an empty items array when DynamoDB returns undefined Items', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });

      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: { pair: 'BTC-USDT' },
        queryStringParameters: { period: '1h' },
      });

      const result = await getPriceHistory(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toEqual([]);
    });

    /** Validation — missing pair path parameter returns 400. */
    it('returns 400 when pair path parameter is missing', async () => {
      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: null,
      });

      const result = await getPriceHistory(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toBe('Missing pair');
      expect(mockSend).not.toHaveBeenCalled();
    });

    /** Validation — unknown period value returns 400. */
    it('returns 400 for an unrecognised period value', async () => {
      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: { pair: 'BTC-USDT' },
        queryStringParameters: { period: '2w' },
      });

      const result = await getPriceHistory(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toBe('Invalid period: 2w');
      expect(mockSend).not.toHaveBeenCalled();
    });

    /** Auth — missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        httpMethod: 'GET',
        resource: '/trading/price-history/{pair}',
        pathParameters: { pair: 'BTC-USDT' },
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await getPriceHistory(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
