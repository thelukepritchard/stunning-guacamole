// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockDdbSend = jest.fn();
const mockSnsSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockDdbSend }) },
  PutCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Put' })),
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: mockSnsSend })),
  PublishCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Publish' })),
}));

import { handler } from '../async/price-publisher';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a mock klines response with 200 candles. */
function buildKlinesResponse() {
  return Array.from({ length: 200 }, (_, i) => [
    Date.now() + i * 60_000,
    '50000',        // open
    '50500',        // high
    '49500',        // low
    String(50_000 + (i % 10) * 100), // close
    '100',          // volume
  ]);
}

/** Builds a mock ticker response. */
function buildTickerResponse() {
  return {
    volume: '25000.5',
    priceChangePercent: '2.35',
    lastPrice: '50900',
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('price-publisher handler', () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    PutCommand.mockImplementation((params: object) => ({ ...params, _type: 'Put' }));
    const { PublishCommand } = jest.requireMock('@aws-sdk/client-sns') as { PublishCommand: jest.Mock };
    PublishCommand.mockImplementation((params: object) => ({ ...params, _type: 'Publish' }));

    process.env.PRICE_HISTORY_TABLE_NAME = 'price-history-table';
    process.env.SNS_TOPIC_ARN = 'arn:aws:sns:ap-southeast-2:123456789012:price-topic';

    mockFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  // ── successful flow ──────────────────────────────────────────────────────────

  /**
   * Should fetch klines and ticker from Binance, calculate indicators,
   * store a price history record, and publish to SNS.
   */
  it('should fetch data, store price history, and publish to SNS', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => buildKlinesResponse(),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => buildTickerResponse(),
      } as Response);

    mockDdbSend.mockResolvedValueOnce({});
    mockSnsSend.mockResolvedValueOnce({});

    await handler();

    // Verify Binance API calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [klinesUrl] = mockFetch.mock.calls[0] as [string];
    const [tickerUrl] = mockFetch.mock.calls[1] as [string];
    expect(klinesUrl).toContain('klines');
    expect(klinesUrl).toContain('BTCUSDT');
    expect(tickerUrl).toContain('ticker/24hr');

    // Verify DynamoDB put
    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).toHaveBeenCalledTimes(1);
    const putParams = PutCommand.mock.calls[0][0];
    expect(putParams.TableName).toBe('price-history-table');
    expect(putParams.Item.pair).toBe('BTC');
    expect(putParams.Item.price).toBe(50_900);
    expect(putParams.Item.volume_24h).toBe(25_000.5);
    expect(typeof putParams.Item.timestamp).toBe('string');
    expect(typeof putParams.Item.ttl).toBe('number');
    expect(putParams.Item.indicators).toBeDefined();

    // Verify SNS publish
    const { PublishCommand } = jest.requireMock('@aws-sdk/client-sns') as { PublishCommand: jest.Mock };
    expect(PublishCommand).toHaveBeenCalledTimes(1);
    const publishParams = PublishCommand.mock.calls[0][0];
    expect(publishParams.TopicArn).toBe('arn:aws:sns:ap-southeast-2:123456789012:price-topic');
    expect(publishParams.MessageAttributes.pair.StringValue).toBe('BTC');
  });

  // ── SNS message attributes ──────────────────────────────────────────────────

  /**
   * Should include all indicator fields as SNS message attributes.
   */
  it('should include all indicator fields in SNS message attributes', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => buildKlinesResponse() } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => buildTickerResponse() } as Response);

    mockDdbSend.mockResolvedValueOnce({});
    mockSnsSend.mockResolvedValueOnce({});

    await handler();

    const { PublishCommand } = jest.requireMock('@aws-sdk/client-sns') as { PublishCommand: jest.Mock };
    const attrs = PublishCommand.mock.calls[0][0].MessageAttributes;

    // Numeric fields
    expect(attrs.price).toBeDefined();
    expect(attrs.volume_24h).toBeDefined();
    expect(attrs.rsi_14).toBeDefined();
    expect(attrs.rsi_7).toBeDefined();
    expect(attrs.macd_histogram).toBeDefined();
    expect(attrs.sma_20).toBeDefined();
    expect(attrs.sma_50).toBeDefined();
    expect(attrs.sma_200).toBeDefined();
    expect(attrs.ema_12).toBeDefined();
    expect(attrs.ema_20).toBeDefined();
    expect(attrs.ema_26).toBeDefined();
    expect(attrs.bb_upper).toBeDefined();
    expect(attrs.bb_lower).toBeDefined();

    // String fields
    expect(attrs.macd_signal).toBeDefined();
    expect(attrs.bb_position).toBeDefined();

    // Verify data types
    expect(attrs.price.DataType).toBe('Number');
    expect(attrs.macd_signal.DataType).toBe('String');
  });

  // ── Binance API error ────────────────────────────────────────────────────────

  /**
   * Should throw when Binance klines API returns non-OK status.
   */
  it('should throw when Binance klines API fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 502 } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => buildTickerResponse() } as Response);

    await expect(handler()).rejects.toThrow('Binance API error');
  });

  /**
   * Should throw when Binance ticker API returns non-OK status.
   */
  it('should throw when Binance ticker API fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => buildKlinesResponse() } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    await expect(handler()).rejects.toThrow('Binance API error');
  });

  // ── price history TTL ────────────────────────────────────────────────────────

  /**
   * The price history record TTL should be ~30 days from now.
   */
  it('should set TTL to approximately 30 days from now', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => buildKlinesResponse() } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => buildTickerResponse() } as Response);

    mockDdbSend.mockResolvedValueOnce({});
    mockSnsSend.mockResolvedValueOnce({});

    const beforeTimestamp = Math.floor(Date.now() / 1000);
    await handler();
    const afterTimestamp = Math.floor(Date.now() / 1000);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const ttl = PutCommand.mock.calls[0][0].Item.ttl;
    const thirtyDaysInSeconds = 30 * 24 * 60 * 60;

    expect(ttl).toBeGreaterThanOrEqual(beforeTimestamp + thirtyDaysInSeconds);
    expect(ttl).toBeLessThanOrEqual(afterTimestamp + thirtyDaysInSeconds);
  });
});
