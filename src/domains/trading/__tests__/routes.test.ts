import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockSend = jest.fn();
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
 * Each handler is tested with mocked DynamoDB calls.
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
    /** Verifies a valid request creates a bot and returns 201. */
    it('returns 201 with the created bot for a valid body', async () => {
      mockSend.mockResolvedValueOnce({});

      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({
          name: 'Test Bot',
          pair: 'BTC/USDT',
          action: 'buy',
          query: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
        }),
      });

      const result = await createBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(body.name).toBe('Test Bot');
      expect(body.pair).toBe('BTC/USDT');
      expect(body.action).toBe('buy');
      expect(body.status).toBe('draft');
      expect(body.botId).toBeDefined();
      expect(body.sub).toBe('user-123');
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
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
    });

    /** Verifies missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        httpMethod: 'POST',
        resource: '/trading/bots',
        body: JSON.stringify({
          name: 'Test Bot',
          pair: 'BTC/USDT',
          action: 'buy',
          query: { combinator: 'and', rules: [] },
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
      const updatedAttrs = { botId: 'bot-001', name: 'Updated Bot', sub: 'user-123' };
      mockSend.mockResolvedValueOnce({ Attributes: updatedAttrs });

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

    /** Verifies ConditionalCheckFailedException returns 404. */
    it('returns 404 when bot is not found (ConditionalCheckFailedException)', async () => {
      const error = new Error('Condition not met');
      (error as unknown as { name: string }).name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

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
      const error = new Error('Internal error');
      (error as unknown as { name: string }).name = 'InternalServerError';
      mockSend.mockRejectedValueOnce(error);

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      await expect(updateBot(event)).rejects.toThrow('Internal error');
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
    /** Verifies successful deletion returns 200. */
    it('returns 200 with deletion confirmation', async () => {
      mockSend.mockResolvedValueOnce({});

      const event = buildRouteEvent({
        httpMethod: 'DELETE',
        resource: '/trading/bots/{botId}',
        pathParameters: { botId: 'bot-001' },
      });

      const result = await deleteBot(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body).toEqual({ botId: 'bot-001', deleted: true });
      expect(mockSend).toHaveBeenCalledTimes(1);
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
