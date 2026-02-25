import type { SNSEvent } from 'aws-lambda';
import type { IndicatorSnapshot } from '../types';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
  GetCommand: jest.fn((params) => ({ ...params, _type: 'Get' })),
  PutCommand: jest.fn((params) => ({ ...params, _type: 'Put' })),
  UpdateCommand: jest.fn((params) => ({ ...params, _type: 'Update' })),
}));

import { handler } from '../async/bot-executor';

/**
 * Tests for the bot executor Lambda.
 * Verifies execution modes (once_and_wait, condition_cooldown) and
 * correct trade signal recording with atomic conditional writes.
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

  /** GSI result helper — returns just the keys for the two-step lookup. */
  const gsiHit = { Items: [{ sub: 'user-123', botId: 'bot-001' }] };

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

  /** Verifies the handler exits early when the bot is not found via GSI. */
  it('exits early when bot is not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] }); // GSI — no match

    const event = buildSnsEvent(
      'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic:nonexistent',
      indicators,
    );

    await handler(event);

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  /** Verifies the handler exits early when the bot is not active. */
  it('exits early when bot is not active', async () => {
    const bot = {
      sub: 'user-123',
      botId: 'bot-001',
      pair: 'BTC/USDT',
      status: 'paused',
      executionMode: 'condition_cooldown',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    };

    mockSend.mockResolvedValueOnce(gsiHit); // GSI
    mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get

    const event = buildSnsEvent(
      'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic:sub-001',
      indicators,
    );

    await handler(event);

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  /**
   * Tests for condition_cooldown mode.
   */
  describe('condition_cooldown mode', () => {
    /** Verifies a buy trade fires when conditions match and no cooldown is active. */
    it('records a buy trade when buyQuery matches', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // trade put

      await handler(buildSnsEvent('arn:sub-001', indicators));

      // GSI + get + trade (no conditional update when no cooldown)
      expect(mockSend).toHaveBeenCalledTimes(3);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.action).toBe('buy');
    });

    /** Verifies a trade is suppressed when the conditional update loses (concurrent invocation). */
    it('suppresses trade when conditional update is rejected', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        cooldownMinutes: 30,
        subscriptionArn: 'arn:sub-001',
      };

      const conditionError = new Error('Condition not met');
      (conditionError as unknown as { name: string }).name = 'ConditionalCheckFailedException';

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockRejectedValueOnce(conditionError); // conditional update rejected

      await handler(buildSnsEvent('arn:sub-001', indicators));

      // GSI + get + rejected conditional update — no trade recorded
      expect(mockSend).toHaveBeenCalledTimes(3);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand).not.toHaveBeenCalled();
    });

    /** Verifies conditional update sets buyCooldownUntil when cooldownMinutes is configured. */
    it('sets buyCooldownUntil in conditional update when cooldownMinutes is set', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        cooldownMinutes: 30,
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // conditional update (set buyCooldownUntil)
      mockSend.mockResolvedValueOnce({}); // trade put

      await handler(buildSnsEvent('arn:sub-001', indicators));

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      const updateCall = UpdateCommand.mock.calls[UpdateCommand.mock.calls.length - 1][0];
      expect(updateCall.ExpressionAttributeNames['#cd']).toBe('buyCooldownUntil');
      expect(updateCall.ExpressionAttributeValues[':cd']).toBeDefined();
    });

    /** Verifies no conditional update when cooldownMinutes is not configured. */
    it('does not use conditional update when cooldownMinutes is not configured', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // trade put (no conditional update)

      await handler(buildSnsEvent('arn:sub-001', indicators));

      // GSI + get + trade — no UpdateCommand
      expect(mockSend).toHaveBeenCalledTimes(3);
      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      expect(UpdateCommand).not.toHaveBeenCalled();
    });

    /** Verifies buy is suppressed when buyCooldownUntil is in the future. */
    it('suppresses buy trade when buyCooldownUntil is in the future', async () => {
      const futureTime = new Date(Date.now() + 30 * 60_000).toISOString();
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        cooldownMinutes: 30,
        buyCooldownUntil: futureTime,
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get

      await handler(buildSnsEvent('arn:sub-001', indicators));

      // GSI + get — buy suppressed by cooldown
      expect(mockSend).toHaveBeenCalledTimes(2);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand).not.toHaveBeenCalled();
    });

    /** Verifies sell fires even when buy cooldown is active (independent cooldowns). */
    it('fires sell trade even when buy cooldown is active', async () => {
      const futureTime = new Date(Date.now() + 30 * 60_000).toISOString();
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        buyCooldownUntil: futureTime, // Buy is in cooldown
        sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '60' }] },
        cooldownMinutes: 30,
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // sell conditional update
      mockSend.mockResolvedValueOnce({}); // sell trade put

      await handler(buildSnsEvent('arn:sub-001', indicators));

      // GSI + get + sell (conditional + trade) — buy skipped by cooldown
      expect(mockSend).toHaveBeenCalledTimes(4);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.action).toBe('sell');
    });

    /** Verifies trade fires when buyCooldownUntil has expired. */
    it('allows buy trade when buyCooldownUntil has expired', async () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        cooldownMinutes: 30,
        buyCooldownUntil: pastTime,
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // conditional update (set buyCooldownUntil)
      mockSend.mockResolvedValueOnce({}); // trade put

      await handler(buildSnsEvent('arn:sub-001', indicators));

      // GSI + get + conditional update + trade
      expect(mockSend).toHaveBeenCalledTimes(4);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.action).toBe('buy');
    });

    /** Verifies both buy and sell fire independently when no cooldown is configured. */
    it('records both buy and sell trades independently when no cooldown', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '60' }] },
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // buy trade put
      mockSend.mockResolvedValueOnce({}); // sell trade put

      await handler(buildSnsEvent('arn:sub-001', indicators));

      // GSI + get + buy trade + sell trade (no conditional updates)
      expect(mockSend).toHaveBeenCalledTimes(4);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[0][0].Item.action).toBe('buy');
      expect(PutCommand.mock.calls[1][0].Item.action).toBe('sell');
    });

    /** Verifies both buy and sell fire with cooldown and independent cooldown timestamps. */
    it('records both buy and sell with independent cooldown timestamps', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '60' }] },
        cooldownMinutes: 30,
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // buy conditional update
      mockSend.mockResolvedValueOnce({}); // buy trade put
      mockSend.mockResolvedValueOnce({}); // sell conditional update
      mockSend.mockResolvedValueOnce({}); // sell trade put

      await handler(buildSnsEvent('arn:sub-001', indicators));

      // GSI + get + buy (conditional + trade) + sell (conditional + trade)
      expect(mockSend).toHaveBeenCalledTimes(6);
      const { UpdateCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
      // Buy sets buyCooldownUntil
      expect(UpdateCommand.mock.calls[0][0].ExpressionAttributeNames['#cd']).toBe('buyCooldownUntil');
      // Sell sets sellCooldownUntil
      expect(UpdateCommand.mock.calls[1][0].ExpressionAttributeNames['#cd']).toBe('sellCooldownUntil');
      expect(PutCommand.mock.calls[0][0].Item.action).toBe('buy');
      expect(PutCommand.mock.calls[1][0].Item.action).toBe('sell');
    });

    /** Verifies both actions suppressed when both cooldowns are active. */
    it('suppresses both trades when both cooldowns are in the future', async () => {
      const futureTime = new Date(Date.now() + 30 * 60_000).toISOString();
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '60' }] },
        cooldownMinutes: 30,
        buyCooldownUntil: futureTime,
        sellCooldownUntil: futureTime,
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get

      await handler(buildSnsEvent('arn:sub-001', indicators));

      // GSI + get — both suppressed
      expect(mockSend).toHaveBeenCalledTimes(2);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand).not.toHaveBeenCalled();
    });
  });

  /**
   * Tests for once_and_wait mode.
   */
  describe('once_and_wait mode', () => {
    /** Verifies a buy trade fires when no previous action exists. */
    it('records a buy trade on first trigger (no lastAction)', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'once_and_wait',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // conditional update (claim action)
      mockSend.mockResolvedValueOnce({}); // trade put

      await handler(buildSnsEvent('arn:sub-001', indicators));

      expect(mockSend).toHaveBeenCalledTimes(4);
      const { PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.action).toBe('buy');
      const updateCall = UpdateCommand.mock.calls[UpdateCommand.mock.calls.length - 1][0];
      expect(updateCall.ExpressionAttributeValues[':action']).toBe('buy');
    });

    /** Verifies buy is blocked when lastAction is 'buy'. */
    it('blocks buy when lastAction is buy', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'once_and_wait',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        lastAction: 'buy',
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get

      await handler(buildSnsEvent('arn:sub-001', indicators));

      // GSI + get — buy blocked, no sell query to evaluate
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    /** Verifies sell fires when lastAction is 'buy' (counter-action). */
    it('allows sell when lastAction is buy (counter-action)', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'once_and_wait',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '60' }] },
        lastAction: 'buy',
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // conditional update (claim action)
      mockSend.mockResolvedValueOnce({}); // sell trade put

      await handler(buildSnsEvent('arn:sub-001', indicators));

      expect(mockSend).toHaveBeenCalledTimes(4);
      const { PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.action).toBe('sell');
      expect(UpdateCommand.mock.calls[UpdateCommand.mock.calls.length - 1][0].ExpressionAttributeValues[':action']).toBe('sell');
    });

    /** Verifies only one action fires per evaluation (buy takes priority). */
    it('fires only buy when both queries match and no lastAction', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'once_and_wait',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '60' }] },
        subscriptionArn: 'arn:sub-001',
      };

      mockSend.mockResolvedValueOnce(gsiHit); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // buy conditional update
      mockSend.mockResolvedValueOnce({}); // buy trade put

      await handler(buildSnsEvent('arn:sub-001', indicators));

      // GSI + get + buy (conditional + trade) — sell skipped
      expect(mockSend).toHaveBeenCalledTimes(4);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.action).toBe('buy');
    });
  });

  /** Verifies unexpected errors are caught and do not throw from the handler. */
  it('catches unexpected errors and does not throw', async () => {
    const permissionError = new Error('User is not authorized to perform: dynamodb:UpdateItem');
    (permissionError as unknown as { name: string }).name = 'AccessDeniedException';

    const bot = {
      sub: 'user-123',
      botId: 'bot-001',
      pair: 'BTC/USDT',
      status: 'active',
      executionMode: 'condition_cooldown',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
      cooldownMinutes: 30,
      subscriptionArn: 'arn:sub-001',
    };

    mockSend.mockResolvedValueOnce(gsiHit); // GSI
    mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
    mockSend.mockRejectedValueOnce(permissionError); // conditional update — permission denied

    // Should not throw — error is caught and logged
    await expect(handler(buildSnsEvent('arn:sub-001', indicators))).resolves.toBeUndefined();

    // No trade should have been recorded
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    expect(PutCommand).not.toHaveBeenCalled();
  });

  /** Verifies the trade record includes correct fields. */
  it('records a trade with correct fields', async () => {
    const bot = {
      sub: 'user-123',
      botId: 'bot-001',
      pair: 'BTC/USDT',
      status: 'active',
      executionMode: 'condition_cooldown',
      sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '60' }] },
      subscriptionArn: 'arn:sub-002',
    };

    mockSend.mockResolvedValueOnce(gsiHit); // GSI
    mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
    mockSend.mockResolvedValueOnce({}); // conditional update (enter cooldown)
    mockSend.mockResolvedValueOnce({}); // trade put

    await handler(buildSnsEvent('arn:sub-002', indicators));

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
