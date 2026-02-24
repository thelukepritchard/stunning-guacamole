import type { SNSEvent } from 'aws-lambda';
import type { IndicatorSnapshot } from '../types';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
  PutCommand: jest.fn((params) => ({ ...params, _type: 'Put' })),
}));

import { handler } from '../async/bot-executor';

/**
 * Tests for the bot executor Lambda.
 * Verifies that SNS indicator messages are evaluated against bot rules,
 * and trade signals are recorded when rules match.
 */
describe('bot-executor handler', () => {
  /** Baseline indicator snapshot for all tests. */
  const indicators: IndicatorSnapshot = {
    price: 50000,
    volume_24h: 15000,
    price_change_pct: 2.5,
    rsi_14: 65,
    rsi_7: 70,
    macd_histogram: 150,
    macd_signal: 'above_signal',
    sma_20: 49500,
    sma_50: 48000,
    sma_200: 45000,
    ema_12: 49800,
    ema_20: 49600,
    ema_26: 49400,
    bb_upper: 51000,
    bb_lower: 48000,
    bb_position: 'between_bands',
  };

  /**
   * Builds a mock SNS event with indicator data.
   *
   * @param subscriptionArn - The subscription ARN for the record.
   * @param message - The indicators to include in the message.
   * @returns A mock SNS event.
   */
  function buildSnsEvent(subscriptionArn: string, message: IndicatorSnapshot): SNSEvent {
    return {
      Records: [
        {
          EventSource: 'aws:sns',
          EventSubscriptionArn: subscriptionArn,
          EventVersion: '1.0',
          Sns: {
            Type: 'Notification',
            MessageId: 'msg-001',
            TopicArn: 'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic',
            Message: JSON.stringify(message),
            Timestamp: '2026-01-01T00:00:00.000Z',
            SignatureVersion: '1',
            Signature: '',
            SigningCertUrl: '',
            UnsubscribeUrl: '',
            MessageAttributes: {},
          },
        },
      ],
    } as unknown as SNSEvent;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOTS_TABLE_NAME = 'BotsTable';
    process.env.TRADES_TABLE_NAME = 'TradesTable';
  });

  /** Verifies a trade is recorded when the bot is found, active, and rules match. */
  it('records a trade when bot is found, active, and rules match', async () => {
    const bot = {
      sub: 'user-123',
      botId: 'bot-001',
      name: 'Test Bot',
      pair: 'BTC/USDT',
      action: 'buy',
      status: 'active',
      query: {
        combinator: 'and',
        rules: [{ field: 'price', operator: '>', value: '40000' }],
      },
      subscriptionArn: 'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic:sub-001',
    };

    // First call: QueryCommand for bot lookup
    mockSend.mockResolvedValueOnce({ Items: [bot] });
    // Second call: PutCommand for trade recording
    mockSend.mockResolvedValueOnce({});

    const event = buildSnsEvent(
      'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic:sub-001',
      indicators,
    );

    await handler(event);

    expect(mockSend).toHaveBeenCalledTimes(2);
    // Verify PutCommand was used for the trade
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    expect(PutCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'TradesTable',
      }),
    );
  });

  /** Verifies no trade is recorded when rules do not match. */
  it('does not record a trade when rules do not match', async () => {
    const bot = {
      sub: 'user-123',
      botId: 'bot-001',
      name: 'Test Bot',
      pair: 'BTC/USDT',
      action: 'buy',
      status: 'active',
      query: {
        combinator: 'and',
        rules: [{ field: 'price', operator: '>', value: '60000' }], // Will not match 50000
      },
      subscriptionArn: 'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic:sub-001',
    };

    mockSend.mockResolvedValueOnce({ Items: [bot] });

    const event = buildSnsEvent(
      'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic:sub-001',
      indicators,
    );

    await handler(event);

    // Only the bot lookup should happen, no trade recording
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  /** Verifies the handler exits early when the bot is not found. */
  it('exits early when bot is not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildSnsEvent(
      'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic:nonexistent',
      indicators,
    );

    await handler(event);

    // Only the bot lookup should happen
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  /** Verifies the handler exits early when the bot is not active. */
  it('exits early when bot is not active', async () => {
    const bot = {
      sub: 'user-123',
      botId: 'bot-001',
      name: 'Test Bot',
      pair: 'BTC/USDT',
      action: 'buy',
      status: 'paused',
      query: {
        combinator: 'and',
        rules: [{ field: 'price', operator: '>', value: '40000' }],
      },
    };

    mockSend.mockResolvedValueOnce({ Items: [bot] });

    const event = buildSnsEvent(
      'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic:sub-001',
      indicators,
    );

    await handler(event);

    // Only the bot lookup should happen, no trade recording
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  /** Verifies the trade record includes correct fields. */
  it('records a trade with correct fields', async () => {
    const bot = {
      sub: 'user-123',
      botId: 'bot-001',
      name: 'Test Bot',
      pair: 'BTC/USDT',
      action: 'sell',
      status: 'active',
      query: {
        combinator: 'and',
        rules: [{ field: 'rsi_14', operator: '>', value: '60' }],
      },
      subscriptionArn: 'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic:sub-002',
    };

    mockSend.mockResolvedValueOnce({ Items: [bot] });
    mockSend.mockResolvedValueOnce({});

    const event = buildSnsEvent(
      'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic:sub-002',
      indicators,
    );

    await handler(event);

    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    const putCall = PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0];

    expect(putCall.Item.botId).toBe('bot-001');
    expect(putCall.Item.sub).toBe('user-123');
    expect(putCall.Item.pair).toBe('BTC/USDT');
    expect(putCall.Item.action).toBe('sell');
    expect(putCall.Item.price).toBe(50000);
    expect(putCall.Item.indicators).toEqual(indicators);
    expect(putCall.Item.timestamp).toBeDefined();
    expect(putCall.Item.createdAt).toBeDefined();
  });
});
