const mockSnsSend = jest.fn();
jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({ send: mockSnsSend })),
  PublishCommand: jest.fn((params) => ({ ...params, _type: 'Publish' })),
}));

import { handler } from '../async/price-publisher';

/**
 * Tests for the price publisher Lambda.
 * Verifies that Binance market data is fetched, indicators are calculated,
 * and results are published to SNS with correct message attributes.
 */
describe('price-publisher handler', () => {
  /** Mock klines response (200 candles). */
  const mockCandles = Array.from({ length: 200 }, (_, i) => {
    const close = 50000 + Math.sin(i / 10) * 1000;
    return [i * 60000, String(close - 50), String(close + 50), String(close - 100), String(close), '100'];
  });

  /** Mock 24h ticker response. */
  const mockTicker = {
    volume: '15000.5',
    priceChangePercent: '2.35',
    lastPrice: '50500',
  };

  /** Stores the original global fetch for restoration. */
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SNS_TOPIC_ARN = 'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic';
    mockSnsSend.mockResolvedValue({});

    global.fetch = jest.fn((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('klines')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockCandles),
        });
      }
      if (urlStr.includes('ticker')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTicker),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /** Verifies that both klines and ticker APIs are fetched. */
  it('fetches klines and ticker data from Binance', async () => {
    await handler();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('klines?symbol=BTCUSDT'),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('ticker/24hr?symbol=BTCUSDT'),
    );
  });

  /** Verifies SNS publish is called with correct topic ARN. */
  it('publishes to the correct SNS topic', async () => {
    await handler();

    const { PublishCommand } = require('@aws-sdk/client-sns');
    expect(mockSnsSend).toHaveBeenCalledTimes(1);
    expect(PublishCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TopicArn: 'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic',
      }),
    );
  });

  /** Verifies the SNS message contains serialised indicator data. */
  it('publishes a JSON message with indicator data', async () => {
    await handler();

    const { PublishCommand } = require('@aws-sdk/client-sns');
    const call = PublishCommand.mock.calls[0][0];
    const message = JSON.parse(call.Message);

    expect(message.price).toBe(50500);
    expect(message.volume_24h).toBe(15000.5);
    expect(typeof message.rsi_14).toBe('number');
    expect(typeof message.macd_signal).toBe('string');
  });

  /** Verifies message attributes include pair and numeric/string indicators. */
  it('includes correct message attributes', async () => {
    await handler();

    const { PublishCommand } = require('@aws-sdk/client-sns');
    const call = PublishCommand.mock.calls[0][0];
    const attrs = call.MessageAttributes;

    expect(attrs.pair).toEqual({ DataType: 'String', StringValue: 'BTC/USDT' });
    expect(attrs.price).toEqual({ DataType: 'Number', StringValue: '50500' });
    expect(attrs.rsi_14.DataType).toBe('Number');
    expect(attrs.macd_signal.DataType).toBe('String');
    expect(attrs.bb_position.DataType).toBe('String');
  });

  /** Verifies the handler throws when the Binance API returns an error. */
  it('throws when Binance API returns an error', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 503 }),
    ) as unknown as typeof fetch;

    await expect(handler()).rejects.toThrow('Binance API error');
  });
});
