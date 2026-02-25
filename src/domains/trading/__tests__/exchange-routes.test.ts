import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockSend = jest.fn();
const mockKmsSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  PutCommand: jest.fn((params) => ({ ...params, _type: 'Put' })),
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
  GetCommand: jest.fn((params) => ({ ...params, _type: 'Get' })),
  UpdateCommand: jest.fn((params) => ({ ...params, _type: 'Update' })),
}));
jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn(() => ({ send: mockKmsSend })),
  EncryptCommand: jest.fn((params) => ({ ...params, _type: 'Encrypt' })),
}));

import { getSettings } from '../routes/get-settings';
import { updateSettings } from '../routes/update-settings';
import { getExchangeOptions } from '../routes/get-exchange-options';

/**
 * Builds a mock API Gateway proxy event for settings route handler tests.
 *
 * @param overrides - Partial event properties to merge into the defaults.
 * @returns A fully-formed mock API Gateway proxy event.
 */
function buildRouteEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    resource: '/trading/settings',
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: '/trading/settings',
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
 * Tests for trading settings route handlers.
 * Each handler is tested with mocked DynamoDB and KMS calls.
 */
describe('trading settings route handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SETTINGS_TABLE_NAME = 'SettingsTable';
    process.env.BOTS_TABLE_NAME = 'BotsTable';
    process.env.KMS_KEY_ID = 'test-key-id';
    mockKmsSend.mockResolvedValue({
      CiphertextBlob: new Uint8Array([1, 2, 3, 4]),
    });
  });

  /**
   * Tests for the getSettings route handler.
   */
  describe('getSettings', () => {
    /** Verifies settings are returned when configured. */
    it('returns 200 with trading settings', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          sub: 'user-123',
          exchange: 'swyftx',
          baseCurrency: 'AUD',
          maskedApiKey: '••••••••abcd',
          encryptedApiKey: 'enc-key',
          encryptedApiSecret: 'enc-secret',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });

      const result = await getSettings(buildRouteEvent());
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.exchange).toBe('swyftx');
      expect(body.baseCurrency).toBe('AUD');
      expect(body.maskedApiKey).toBe('••••••••abcd');
      // Verify encrypted fields are stripped
      expect(body.encryptedApiKey).toBeUndefined();
      expect(body.encryptedApiSecret).toBeUndefined();
      expect(body.sub).toBeUndefined();
    });

    /** Verifies demo defaults are returned when no settings record exists. */
    it('returns 200 with demo defaults when no settings configured', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await getSettings(buildRouteEvent());
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.exchange).toBe('demo');
      expect(body.baseCurrency).toBe('USD');
      expect(body.maskedApiKey).toBeUndefined();
      expect(body.updatedAt).toBeDefined();
    });

    /** Verifies missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await getSettings(event);
      expect(result.statusCode).toBe(401);
    });
  });

  /**
   * Tests for the updateSettings route handler.
   */
  describe('updateSettings', () => {
    /** Verifies a valid initial settings creation. */
    it('returns 200 with settings for a valid first-time setup', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand — no existing settings
      mockSend.mockResolvedValueOnce({}); // PutCommand

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          exchange: 'swyftx',
          baseCurrency: 'AUD',
          apiKey: 'my-api-key-1234',
          apiSecret: 'my-api-secret',
        }),
      });

      const result = await updateSettings(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.exchange).toBe('swyftx');
      expect(body.baseCurrency).toBe('AUD');
      expect(body.maskedApiKey).toContain('1234');
      // Verify secrets are not in the response
      expect(body.encryptedApiKey).toBeUndefined();
      expect(body.encryptedApiSecret).toBeUndefined();
      expect(body.apiKey).toBeUndefined();
      expect(body.apiSecret).toBeUndefined();
    });

    /** Verifies demo is rejected — it is not a selectable exchange. */
    it('returns 400 when trying to select demo as an exchange', async () => {
      const event = buildRouteEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          exchange: 'demo',
          baseCurrency: 'USD',
          apiKey: 'key',
          apiSecret: 'secret',
        }),
      });

      const result = await updateSettings(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('Unsupported exchange');
    });

    /** Verifies KMS encrypt is called for both key and secret. */
    it('encrypts both apiKey and apiSecret via KMS', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand
      mockSend.mockResolvedValueOnce({}); // PutCommand

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          exchange: 'coinspot',
          baseCurrency: 'AUD',
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        }),
      });

      await updateSettings(event);

      expect(mockKmsSend).toHaveBeenCalledTimes(2);
    });

    /** Verifies all active bots are disabled when exchange changes. */
    it('disables all active bots when exchange changes', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { sub: 'user-123', exchange: 'swyftx', baseCurrency: 'AUD' },
      }); // GetCommand — existing settings with different exchange
      mockSend.mockResolvedValueOnce({
        Items: [
          { sub: 'user-123', botId: 'bot-1', status: 'active' },
          { sub: 'user-123', botId: 'bot-2', status: 'active' },
        ],
      }); // QueryCommand — find active bots
      mockSend.mockResolvedValueOnce({}); // UpdateCommand — disable bot-1
      mockSend.mockResolvedValueOnce({}); // UpdateCommand — disable bot-2
      mockSend.mockResolvedValueOnce({}); // PutCommand — save new settings

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          exchange: 'coinjar',
          baseCurrency: 'AUD',
          apiKey: 'new-key-wxyz',
          apiSecret: 'new-secret',
        }),
      });

      const result = await updateSettings(event);

      expect(result.statusCode).toBe(200);
      // GetCommand + QueryCommand + 2x UpdateCommand + PutCommand = 5 calls
      expect(mockSend).toHaveBeenCalledTimes(5);
    });

    /** Verifies bots are NOT disabled when exchange stays the same. */
    it('does not disable bots when exchange stays the same', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { sub: 'user-123', exchange: 'swyftx', baseCurrency: 'AUD' },
      }); // GetCommand — same exchange
      mockSend.mockResolvedValueOnce({}); // PutCommand

      const event = buildRouteEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          exchange: 'swyftx',
          baseCurrency: 'USD',
          apiKey: 'new-key',
          apiSecret: 'new-secret',
        }),
      });

      const result = await updateSettings(event);

      expect(result.statusCode).toBe(200);
      // GetCommand + PutCommand = 2 calls (no bot disable query)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    /** Verifies unsupported exchange returns 400. */
    it('returns 400 for unsupported exchange', async () => {
      const event = buildRouteEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          exchange: 'unknown_exchange',
          baseCurrency: 'AUD',
          apiKey: 'key',
          apiSecret: 'secret',
        }),
      });

      const result = await updateSettings(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('Unsupported exchange');
    });

    /** Verifies invalid base currency for exchange returns 400. */
    it('returns 400 for invalid base currency', async () => {
      const event = buildRouteEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          exchange: 'coinspot',
          baseCurrency: 'EUR',
          apiKey: 'key',
          apiSecret: 'secret',
        }),
      });

      const result = await updateSettings(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('Invalid base currency');
    });

    /** Verifies missing fields return 400. */
    it('returns 400 when required fields are missing', async () => {
      const event = buildRouteEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({ exchange: 'swyftx' }),
      });

      const result = await updateSettings(event);
      expect(result.statusCode).toBe(400);
    });

    /** Verifies missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          exchange: 'swyftx',
          baseCurrency: 'AUD',
          apiKey: 'key',
          apiSecret: 'secret',
        }),
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await updateSettings(event);
      expect(result.statusCode).toBe(401);
    });
  });

  /**
   * Tests for the getExchangeOptions route handler.
   */
  describe('getExchangeOptions', () => {
    /** Verifies only real exchanges are returned (demo is excluded). */
    it('returns 200 with real exchange options (no demo)', async () => {
      const result = await getExchangeOptions(buildRouteEvent({
        resource: '/trading/settings/exchange-options',
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.exchanges).toHaveLength(5);

      // Demo should not be in the list
      const demo = body.exchanges.find((e: { exchangeId: string }) => e.exchangeId === 'demo');
      expect(demo).toBeUndefined();

      const swyftx = body.exchanges.find((e: { exchangeId: string }) => e.exchangeId === 'swyftx');
      expect(swyftx).toBeDefined();
      expect(swyftx.name).toBe('Swyftx');
      expect(swyftx.baseCurrencies).toEqual(['AUD', 'USD']);
      expect(swyftx.phase).toBe(1);
      expect(swyftx.description).toBe('Australian cryptocurrency exchange');

      const binance = body.exchanges.find((e: { exchangeId: string }) => e.exchangeId === 'binance');
      expect(binance).toBeDefined();
      expect(binance.phase).toBe(2);
    });

    /** Verifies missing sub returns 401. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        resource: '/trading/settings/exchange-options',
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await getExchangeOptions(event);
      expect(result.statusCode).toBe(401);
    });
  });
});
