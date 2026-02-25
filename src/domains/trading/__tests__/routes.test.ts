import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockSend = jest.fn();
const mockEventBridgeSend = jest.fn();

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

import { createBot } from '../routes/create-bot';
import { listBots } from '../routes/list-bots';
import { getBot } from '../routes/get-bot';
import { updateBot } from '../routes/update-bot';
import { deleteBot } from '../routes/delete-bot';
import { listTrades } from '../routes/list-trades';
import { listBotTrades } from '../routes/list-bot-trades';

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
    jest.clearAllMocks();
    process.env.BOTS_TABLE_NAME = 'BotsTable';
    process.env.TRADES_TABLE_NAME = 'TradesTable';
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
        }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(body.name).toBe('Test Bot');
      expect(body.pair).toBe('BTC/USDT');
      expect(body.executionMode).toBe('condition_cooldown');
      expect(body.buyQuery).toBeDefined();
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
        }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(body.executionMode).toBe('once_and_wait');
      expect(body.buyQuery).toBeDefined();
      expect(body.sellQuery).toBeDefined();
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
          cooldownMinutes: 30,
        }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
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
          sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '70' }] },
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
          sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '70' }] },
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
      const mockBot = { sub: 'user-123', botId: 'bot-001', subscriptionArn: 'arn:sub-001' };
      const mockTrades = [
        { botId: 'bot-001', timestamp: '2026-01-01T00:00:00Z' },
        { botId: 'bot-001', timestamp: '2026-01-01T00:01:00Z' },
      ];
      mockSend.mockResolvedValueOnce({ Item: mockBot }); // GetCommand
      mockSend.mockResolvedValueOnce({}); // DeleteCommand
      mockSend.mockResolvedValueOnce({ Items: mockTrades }); // trade query
      mockSend.mockResolvedValueOnce({}); // batch delete
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
      // Get + Delete + trade query + batch delete
      expect(mockSend).toHaveBeenCalledTimes(4);
      const { BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
      const batchCall = BatchWriteCommand.mock.calls[0][0];
      expect(batchCall.RequestItems.TradesTable).toHaveLength(2);
    });

    /** Verifies a BotDeleted event is published with subscriptionArn. */
    it('publishes a BotDeleted event to EventBridge', async () => {
      const mockBot = { sub: 'user-123', botId: 'bot-001', subscriptionArn: 'arn:sub-001' };
      mockSend.mockResolvedValueOnce({ Item: mockBot }); // GetCommand
      mockSend.mockResolvedValueOnce({}); // DeleteCommand
      mockSend.mockResolvedValueOnce({ Items: [] }); // trade query (empty)
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
      expect(detail.subscriptionArn).toBe('arn:sub-001');
    });

    /** Verifies deletion works when bot has no trades. */
    it('handles bot with no trades gracefully', async () => {
      const mockBot = { sub: 'user-123', botId: 'bot-001' };
      mockSend.mockResolvedValueOnce({ Item: mockBot }); // GetCommand
      mockSend.mockResolvedValueOnce({}); // DeleteCommand
      mockSend.mockResolvedValueOnce({ Items: [] }); // trade query (empty)
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
      // Get + Delete + trade query (no batch delete needed)
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    /** Verifies no event is published when the bot did not exist. */
    it('does not publish event when bot did not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand — not found
      mockSend.mockResolvedValueOnce({}); // DeleteCommand
      mockSend.mockResolvedValueOnce({ Items: [] }); // trade query

      const event = buildRouteEvent({
        httpMethod: 'DELETE',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
      });

      await deleteBot(event);

      expect(mockEventBridgeSend).not.toHaveBeenCalled();
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
});
