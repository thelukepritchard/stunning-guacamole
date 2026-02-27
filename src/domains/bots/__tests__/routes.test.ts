import { buildEvent } from '../../test-utils';

// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockDdbSend = jest.fn();
const mockEbSend = jest.fn();
const mockKmsSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockDdbSend }) },
  QueryCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetCommand: jest.fn().mockImplementation((input) => ({ input })),
  PutCommand: jest.fn().mockImplementation((input) => ({ input })),
  UpdateCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteCommand: jest.fn().mockImplementation((input) => ({ input })),
  BatchWriteCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEbSend })),
  PutEventsCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn().mockImplementation(() => ({ send: mockKmsSend })),
  EncryptCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

// ─── Route imports (after mocks are set up) ───────────────────────────────────

import { listBots } from '../routes/list-bots';
import { createBot } from '../routes/create-bot';
import { getBot } from '../routes/get-bot';
import { updateBot } from '../routes/update-bot';
import { deleteBot } from '../routes/delete-bot';
import { getSettings } from '../routes/get-settings';
import { updateSettings } from '../routes/update-settings';
import { getExchangeOptions } from '../routes/get-exchange-options';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a minimal authorizer event stub for an authenticated user.
 */
function authedEvent(overrides = {}) {
  return buildEvent({
    requestContext: {
      authorizer: { claims: { sub: 'user-123' } },
    } as never,
    ...overrides,
  });
}

// ─── listBots ─────────────────────────────────────────────────────────────────

describe('listBots', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when no sub is present in the authorizer claims.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await listBots(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 200 with items array on success.
   */
  it('should return 200 with items on success', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [{ botId: 'b1' }] });
    const result = await listBots(authedEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ items: [{ botId: 'b1' }] });
  });

  /**
   * Should return empty items array when no bots exist.
   */
  it('should return empty items when DynamoDB returns nothing', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: undefined });
    const result = await listBots(authedEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ items: [] });
  });
});

// ─── createBot ────────────────────────────────────────────────────────────────

describe('createBot', () => {
  const validBody = {
    name: 'My Bot',
    pair: 'BTC',
    executionMode: 'condition_cooldown',
    buyQuery: { combinator: 'and', rules: [] },
    buySizing: { type: 'fixed', value: 100 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
    mockEbSend.mockResolvedValue({});
  });

  /**
   * Should return 401 when no sub is present.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await createBot(buildEvent({ body: JSON.stringify(validBody) }));
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when required fields are missing.
   */
  it('should return 400 when name is missing', async () => {
    const { name: _n, ...body } = validBody;
    const result = await createBot(authedEvent({ body: JSON.stringify(body) }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Missing required fields');
  });

  /**
   * Should return 400 when executionMode is invalid.
   */
  it('should return 400 for invalid executionMode', async () => {
    const result = await createBot(authedEvent({
      body: JSON.stringify({ ...validBody, executionMode: 'bad_mode' }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('executionMode');
  });

  /**
   * Should return 400 when neither buyQuery nor sellQuery is provided.
   */
  it('should return 400 when neither buyQuery nor sellQuery is provided', async () => {
    const { buyQuery: _bq, buySizing: _bs, ...body } = validBody;
    const result = await createBot(authedEvent({ body: JSON.stringify(body) }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('At least one');
  });

  /**
   * Should return 400 when once_and_wait mode is missing sellQuery.
   */
  it('should return 400 when once_and_wait mode lacks sellQuery', async () => {
    const result = await createBot(authedEvent({
      body: JSON.stringify({
        ...validBody,
        executionMode: 'once_and_wait',
        buySizing: { type: 'fixed', value: 100 },
      }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('once_and_wait');
  });

  /**
   * Should return 400 when buyQuery is provided without buySizing.
   */
  it('should return 400 when buyQuery is provided without buySizing', async () => {
    const { buySizing: _bs, ...body } = validBody;
    const result = await createBot(authedEvent({ body: JSON.stringify(body) }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('buySizing is required');
  });

  /**
   * Should return 400 when buySizing has invalid type.
   */
  it('should return 400 when buySizing.type is invalid', async () => {
    const result = await createBot(authedEvent({
      body: JSON.stringify({ ...validBody, buySizing: { type: 'bad', value: 100 } }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain("buySizing.type must be 'fixed' or 'percentage'");
  });

  /**
   * Should return 400 when percentage sizing value exceeds 100.
   */
  it('should return 400 when percentage sizing value exceeds 100', async () => {
    const result = await createBot(authedEvent({
      body: JSON.stringify({ ...validBody, buySizing: { type: 'percentage', value: 150 } }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('between 0 and 100');
  });

  /**
   * Should return 400 when stopLoss.percentage is out of range.
   */
  it('should return 400 when stopLoss.percentage is out of range', async () => {
    const result = await createBot(authedEvent({
      body: JSON.stringify({ ...validBody, stopLoss: { percentage: 0 } }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('stopLoss.percentage');
  });

  /**
   * Should return 400 when takeProfit.percentage is out of range.
   */
  it('should return 400 when takeProfit.percentage is out of range', async () => {
    const result = await createBot(authedEvent({
      body: JSON.stringify({ ...validBody, takeProfit: { percentage: 101 } }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('takeProfit.percentage');
  });

  /**
   * Should return 201 with the created bot record on success.
   */
  it('should return 201 with the created bot on success', async () => {
    mockDdbSend.mockResolvedValue({});
    mockEbSend.mockResolvedValue({});
    const result = await createBot(authedEvent({ body: JSON.stringify(validBody) }));
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.name).toBe('My Bot');
    expect(body.status).toBe('draft');
    expect(body.botId).toBeDefined();
  });

  /**
   * Should still return 201 even when EventBridge publish fails.
   */
  it('should return 201 even if EventBridge publish fails', async () => {
    mockDdbSend.mockResolvedValue({});
    mockEbSend.mockRejectedValue(new Error('EB error'));
    const result = await createBot(authedEvent({ body: JSON.stringify(validBody) }));
    expect(result.statusCode).toBe(201);
  });
});

// ─── getBot ───────────────────────────────────────────────────────────────────

describe('getBot', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await getBot(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when botId path parameter is missing.
   */
  it('should return 400 when botId is missing', async () => {
    const result = await getBot(authedEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing botId');
  });

  /**
   * Should return 404 when bot does not exist.
   */
  it('should return 404 when bot not found', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });
    const result = await getBot(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(404);
  });

  /**
   * Should return 200 with the bot record on success.
   */
  it('should return 200 with the bot record on success', async () => {
    const bot = { botId: 'b1', name: 'Test Bot' };
    mockDdbSend.mockResolvedValueOnce({ Item: bot });
    const result = await getBot(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(bot);
  });
});

// ─── updateBot ────────────────────────────────────────────────────────────────

describe('updateBot', () => {
  const existingBot = {
    sub: 'user-123',
    botId: 'b1',
    name: 'Old Name',
    pair: 'BTC',
    status: 'draft',
    executionMode: 'condition_cooldown',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => jest.resetAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await updateBot(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when botId is missing.
   */
  it('should return 400 when botId is missing', async () => {
    const result = await updateBot(authedEvent({ body: '{"name":"New"}' }));
    expect(result.statusCode).toBe(400);
  });

  /**
   * Should return 400 when no valid fields are provided.
   */
  it('should return 400 when no valid fields to update', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: existingBot });
    const result = await updateBot(authedEvent({
      pathParameters: { botId: 'b1' },
      body: JSON.stringify({ irrelevantField: 'value' }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('No valid fields to update');
  });

  /**
   * Should return 400 for invalid executionMode.
   */
  it('should return 400 for invalid executionMode', async () => {
    const result = await updateBot(authedEvent({
      pathParameters: { botId: 'b1' },
      body: JSON.stringify({ executionMode: 'bad_mode' }),
    }));
    expect(result.statusCode).toBe(400);
  });

  /**
   * Should return 404 when bot does not exist.
   */
  it('should return 404 when bot not found', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });
    const result = await updateBot(authedEvent({
      pathParameters: { botId: 'b1' },
      body: JSON.stringify({ name: 'New Name' }),
    }));
    expect(result.statusCode).toBe(404);
  });

  /**
   * Should return 200 with updated attributes on success.
   */
  it('should return 200 with updated bot on success', async () => {
    const updated = { ...existingBot, name: 'New Name' };
    mockDdbSend
      .mockResolvedValueOnce({ Item: existingBot }) // GetCommand for current bot
      .mockResolvedValueOnce({ Attributes: updated }) // UpdateCommand
      .mockResolvedValue({}); // EventBridge + backtest stale updates
    mockEbSend.mockResolvedValue({});

    const result = await updateBot(authedEvent({
      pathParameters: { botId: 'b1' },
      body: JSON.stringify({ name: 'New Name' }),
    }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).name).toBe('New Name');
  });
});

// ─── deleteBot ────────────────────────────────────────────────────────────────

describe('deleteBot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOTS_TABLE_NAME = 'bots';
    process.env.TRADES_TABLE_NAME = 'trades';
    process.env.BOT_PERFORMANCE_TABLE_NAME = 'bot-performance';
  });

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await deleteBot(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when botId is missing.
   */
  it('should return 400 when botId is missing', async () => {
    const result = await deleteBot(authedEvent());
    expect(result.statusCode).toBe(400);
  });

  /**
   * Should return 200 confirming deletion on success.
   */
  it('should return 200 on success', async () => {
    mockDdbSend.mockResolvedValue({ Items: [] }); // covers DeleteCommand + QueryCommand pages
    mockEbSend.mockResolvedValue({});
    const result = await deleteBot(authedEvent({ pathParameters: { botId: 'b1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ botId: 'b1', deleted: true });
  });
});

// ─── getSettings ─────────────────────────────────────────────────────────────

describe('getSettings', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await getSettings(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return demo defaults when no settings record exists.
   */
  it('should return demo defaults when no settings record exists', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });
    const result = await getSettings(authedEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.exchange).toBe('demo');
    expect(body.maskedApiKey).toBeUndefined();
  });

  /**
   * Should return settings record with masked API key when configured.
   */
  it('should return settings with masked key when configured', async () => {
    const settings = {
      sub: 'user-123',
      exchange: 'binance',
      baseCurrency: 'USDT',
      maskedApiKey: '••••••••abcd',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    mockDdbSend.mockResolvedValueOnce({ Item: settings });
    const result = await getSettings(authedEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.exchange).toBe('binance');
    expect(body.maskedApiKey).toBe('••••••••abcd');
    expect(body.encryptedApiKey).toBeUndefined();
  });
});

// ─── updateSettings ───────────────────────────────────────────────────────────

describe('updateSettings', () => {
  const validBody = {
    exchange: 'binance',
    baseCurrency: 'USDT',
    apiKey: 'my-api-key-1234',
    apiSecret: 'my-api-secret',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
    mockKmsSend.mockResolvedValue({ CiphertextBlob: Buffer.from('encrypted') });
  });

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await updateSettings(buildEvent({ body: JSON.stringify(validBody) }));
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 400 when required fields are missing.
   */
  it('should return 400 when exchange is missing', async () => {
    const { exchange: _e, ...body } = validBody;
    const result = await updateSettings(authedEvent({ body: JSON.stringify(body) }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Missing required fields');
  });

  /**
   * Should return 400 for unsupported exchange.
   */
  it('should return 400 for unsupported exchange', async () => {
    const result = await updateSettings(authedEvent({
      body: JSON.stringify({ ...validBody, exchange: 'bad_exchange' }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Unsupported exchange');
  });

  /**
   * Should return 400 for invalid base currency on the selected exchange.
   */
  it('should return 400 for invalid base currency on selected exchange', async () => {
    const result = await updateSettings(authedEvent({
      body: JSON.stringify({ ...validBody, exchange: 'coinspot', baseCurrency: 'USD' }),
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Invalid base currency');
  });

  /**
   * Should return 200 with masked settings on success.
   */
  it('should return 200 with masked settings on success', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined }); // existing settings check
    mockDdbSend.mockResolvedValue({});
    const result = await updateSettings(authedEvent({ body: JSON.stringify(validBody) }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.exchange).toBe('binance');
    expect(body.maskedApiKey).toContain('1234');
    expect(body.encryptedApiKey).toBeUndefined();
  });
});

// ─── getExchangeOptions ───────────────────────────────────────────────────────

describe('getExchangeOptions', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should return 401 when unauthenticated.
   */
  it('should return 401 when unauthenticated', async () => {
    const result = await getExchangeOptions(buildEvent());
    expect(result.statusCode).toBe(401);
  });

  /**
   * Should return 200 with supported exchanges (no demo).
   */
  it('should return 200 with supported exchanges excluding demo', async () => {
    const result = await getExchangeOptions(authedEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.exchanges).toBeDefined();
    expect(Array.isArray(body.exchanges)).toBe(true);
    const ids = body.exchanges.map((e: { exchangeId: string }) => e.exchangeId);
    expect(ids).not.toContain('demo');
    expect(ids).toContain('binance');
  });
});
