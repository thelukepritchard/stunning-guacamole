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
 * A single static SNS subscription delivers all indicator ticks.
 * The handler queries all active bots for the pair via pair-status GSI
 * and evaluates both buy and sell actions for each bot.
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
   * Builds a mock SNS event with indicator data and pair message attribute.
   *
   * @param message - The indicators to include in the message.
   * @param pair - The trading pair (defaults to 'BTC/USDT').
   * @returns A mock SNS event.
   */
  function buildSnsEvent(message: IndicatorSnapshot, pair = 'BTC/USDT'): SNSEvent {
    return {
      Records: [
        {
          EventSource: 'aws:sns',
          EventSubscriptionArn: 'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic:static-sub',
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
            MessageAttributes: {
              pair: { Type: 'String', Value: pair },
            },
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

  /** Verifies the handler does nothing when no active bots match the pair. */
  it('exits early when no active bots for pair', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] }); // pair-status GSI query

    await handler(buildSnsEvent(indicators));

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  /** Verifies the handler skips a bot that is no longer active on consistent read. */
  it('skips bot that is no longer active on consistent read', async () => {
    const bot = {
      sub: 'user-123',
      botId: 'bot-001',
      pair: 'BTC/USDT',
      status: 'paused',
      executionMode: 'condition_cooldown',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    };

    mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI query
    mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get (paused)

    await handler(buildSnsEvent(indicators));

    // GSI query + consistent get — bot skipped
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  /** Verifies the handler skips records without a pair message attribute. */
  it('skips SNS records without pair attribute', async () => {
    const event: SNSEvent = {
      Records: [
        {
          EventSource: 'aws:sns',
          EventSubscriptionArn: 'arn:sub',
          EventVersion: '1.0',
          Sns: {
            Type: 'Notification',
            MessageId: 'msg-001',
            TopicArn: 'arn:topic',
            Message: JSON.stringify(indicators),
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

    await handler(event);

    expect(mockSend).not.toHaveBeenCalled();
  });

  /**
   * Tests for condition_cooldown mode.
   */
  describe('condition_cooldown mode', () => {
    /** Verifies a buy trade fires when conditions match. */
    it('records a buy trade when buyQuery matches', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // trade put (buy)
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice (buy)

      await handler(buildSnsEvent(indicators));

      // GSI + get + trade + entryPrice
      expect(mockSend).toHaveBeenCalledTimes(4);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.action).toBe('buy');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.trigger).toBe('rule');
    });

    /** Verifies a sell trade fires when sellQuery matches. */
    it('records a sell trade when sellQuery matches', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '60' }] },
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      // buy action skipped (no buyQuery)
      mockSend.mockResolvedValueOnce({}); // trade put (sell)
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice (sell)

      await handler(buildSnsEvent(indicators));

      expect(mockSend).toHaveBeenCalledTimes(4);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.action).toBe('sell');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.trigger).toBe('rule');
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
      };

      const conditionError = new Error('Condition not met');
      (conditionError as unknown as { name: string }).name = 'ConditionalCheckFailedException';

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockRejectedValueOnce(conditionError); // conditional update rejected

      await handler(buildSnsEvent(indicators));

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
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // conditional update (set buyCooldownUntil)
      mockSend.mockResolvedValueOnce({}); // trade put
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice

      await handler(buildSnsEvent(indicators));

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      // First UpdateCommand is cooldown
      const cooldownCall = UpdateCommand.mock.calls[0][0];
      expect(cooldownCall.ExpressionAttributeNames['#cd']).toBe('buyCooldownUntil');
      expect(cooldownCall.ExpressionAttributeValues[':cd']).toBeDefined();
    });

    /** Verifies entry price is set via UpdateCommand when no cooldownMinutes. */
    it('sets entryPrice after buy trade when no cooldownMinutes', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // trade put
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice

      await handler(buildSnsEvent(indicators));

      // GSI + get + trade + entryPrice
      expect(mockSend).toHaveBeenCalledTimes(4);
      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      expect(UpdateCommand).toHaveBeenCalledTimes(1);
      const entryPriceCall = UpdateCommand.mock.calls[0][0];
      expect(entryPriceCall.UpdateExpression).toBe('SET entryPrice = :price');
      expect(entryPriceCall.ExpressionAttributeValues[':price']).toBe(50000);
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
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get

      await handler(buildSnsEvent(indicators));

      // GSI + get — buy suppressed by cooldown
      expect(mockSend).toHaveBeenCalledTimes(2);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand).not.toHaveBeenCalled();
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
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // conditional update (set buyCooldownUntil)
      mockSend.mockResolvedValueOnce({}); // trade put
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice

      await handler(buildSnsEvent(indicators));

      // GSI + get + conditional update + trade + entryPrice
      expect(mockSend).toHaveBeenCalledTimes(5);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.action).toBe('buy');
    });
  });

  /**
   * Tests for once_and_wait mode.
   */
  describe('once_and_wait mode', () => {
    /** Verifies both buy and sell are evaluated per bot invocation. */
    it('records a buy trade on first trigger (no lastAction)', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'once_and_wait',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '90' }] }, // won't match
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // conditional update (claim buy)
      mockSend.mockResolvedValueOnce({}); // trade put (buy)
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice (buy)
      // sell skipped — sell query doesn't match (rsi_14=65 not > 90)

      await handler(buildSnsEvent(indicators));

      // GSI + get + claim + trade + entryPrice
      expect(mockSend).toHaveBeenCalledTimes(5);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.action).toBe('buy');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.trigger).toBe('rule');
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
        sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '90' }] }, // won't match
        lastAction: 'buy',
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      // buy blocked by lastAction; sell query doesn't match

      await handler(buildSnsEvent(indicators));

      // GSI + get — both actions skipped
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
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      // buy blocked by lastAction='buy'
      mockSend.mockResolvedValueOnce({}); // conditional update (claim sell)
      mockSend.mockResolvedValueOnce({}); // sell trade put
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice (clear)

      await handler(buildSnsEvent(indicators));

      // GSI + get + claim + trade + entryPrice
      expect(mockSend).toHaveBeenCalledTimes(5);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item.action).toBe('sell');
    });
  });

  /**
   * Tests for stop-loss and take-profit.
   */
  describe('stop-loss and take-profit', () => {
    /** Verifies stop-loss triggers a sell when price drops below threshold. */
    it('triggers stop-loss sell in condition_cooldown mode', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        stopLoss: { percentage: 10 },
        entryPrice: 55000, // 10% below = 49500 → current price 48000 < 49500 → triggers
      };

      const slIndicators = { ...indicators, price: 48000 };
      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      // buy: no buyQuery → skipped
      mockSend.mockResolvedValueOnce({}); // trade put (sell via SL)
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice (clear)

      await handler(buildSnsEvent(slIndicators));

      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      const trade = PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item;
      expect(trade.action).toBe('sell');
      expect(trade.trigger).toBe('stop_loss');
    });

    /** Verifies take-profit triggers a sell when price rises above threshold. */
    it('triggers take-profit sell in condition_cooldown mode', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        takeProfit: { percentage: 20 },
        entryPrice: 40000, // 20% above = 48000 → current price 50000 > 48000 → triggers
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      // buy: no buyQuery → skipped
      mockSend.mockResolvedValueOnce({}); // trade put (sell via TP)
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice (clear)

      await handler(buildSnsEvent(indicators));

      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      const trade = PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item;
      expect(trade.action).toBe('sell');
      expect(trade.trigger).toBe('take_profit');
    });

    /** Verifies SL/TP does not trigger without an entry price. */
    it('does not trigger SL/TP when entryPrice is not set', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        stopLoss: { percentage: 10 },
        // No entryPrice — SL/TP cannot evaluate, and no sellQuery → no trade
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get

      await handler(buildSnsEvent(indicators));

      // GSI + get — no trade
      expect(mockSend).toHaveBeenCalledTimes(2);
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      expect(PutCommand).not.toHaveBeenCalled();
    });

    /** Verifies SL/TP takes priority over sellQuery in once_and_wait mode. */
    it('triggers stop-loss before sellQuery in once_and_wait mode', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'once_and_wait',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '100000' }] }, // won't match
        sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '90' }] }, // Would NOT match
        stopLoss: { percentage: 5 },
        entryPrice: 50000, // 5% below = 47500 → current price 46000 < 47500 → triggers
        lastAction: 'buy',
      };

      const slIndicators = { ...indicators, price: 46000 };
      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      // buy blocked by lastAction='buy'
      mockSend.mockResolvedValueOnce({}); // conditional update (claim sell)
      mockSend.mockResolvedValueOnce({}); // sell trade put
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice (clear)

      await handler(buildSnsEvent(slIndicators));

      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      const trade = PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item;
      expect(trade.action).toBe('sell');
      expect(trade.trigger).toBe('stop_loss');
    });

    /** Verifies entry price is cleared (REMOVE) after a sell trade. */
    it('clears entryPrice after a sell trade', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '60' }] },
        entryPrice: 45000,
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      // buy: no buyQuery → skipped
      mockSend.mockResolvedValueOnce({}); // trade put (sell)
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice (REMOVE)

      await handler(buildSnsEvent(indicators));

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      const entryPriceCall = UpdateCommand.mock.calls[UpdateCommand.mock.calls.length - 1][0];
      expect(entryPriceCall.UpdateExpression).toBe('REMOVE entryPrice');
    });

    /** Verifies sizing is included in the trade record when configured. */
    it('includes sizing in trade record when configured', async () => {
      const bot = {
        sub: 'user-123',
        botId: 'bot-001',
        pair: 'BTC/USDT',
        status: 'active',
        executionMode: 'condition_cooldown',
        buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
        buySizing: { type: 'fixed', value: 100 },
      };

      mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
      mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
      mockSend.mockResolvedValueOnce({}); // trade put (buy)
      mockSend.mockResolvedValueOnce({}); // updateEntryPrice

      await handler(buildSnsEvent(indicators));

      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      const trade = PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0].Item;
      expect(trade.sizing).toEqual({ type: 'fixed', value: 100 });
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
    };

    mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
    mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
    mockSend.mockRejectedValueOnce(permissionError); // conditional update — permission denied

    // Should not throw — error is caught and logged
    await expect(handler(buildSnsEvent(indicators))).resolves.toBeUndefined();

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
    };

    mockSend.mockResolvedValueOnce({ Items: [{ sub: 'user-123', botId: 'bot-001' }] }); // GSI
    mockSend.mockResolvedValueOnce({ Item: bot }); // consistent get
    // buy: no buyQuery → skipped
    mockSend.mockResolvedValueOnce({}); // trade put (sell)
    mockSend.mockResolvedValueOnce({}); // updateEntryPrice

    await handler(buildSnsEvent(indicators));

    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    const putCall = PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0];

    expect(putCall.Item.botId).toBe('bot-001');
    expect(putCall.Item.sub).toBe('user-123');
    expect(putCall.Item.pair).toBe('BTC/USDT');
    expect(putCall.Item.action).toBe('sell');
    expect(putCall.Item.price).toBe(50000);
    expect(putCall.Item.trigger).toBe('rule');
    expect(putCall.Item.indicators).toEqual(indicators);
    expect(putCall.Item.timestamp).toBeDefined();
    expect(putCall.Item.createdAt).toBeDefined();
  });

  /** Verifies multiple bots are processed in a single invocation. */
  it('processes multiple active bots for the same pair', async () => {
    const bot1 = {
      sub: 'user-111',
      botId: 'bot-001',
      pair: 'BTC/USDT',
      status: 'active',
      executionMode: 'condition_cooldown',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    };
    const bot2 = {
      sub: 'user-222',
      botId: 'bot-002',
      pair: 'BTC/USDT',
      status: 'active',
      executionMode: 'condition_cooldown',
      buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    };

    mockSend.mockResolvedValueOnce({
      Items: [
        { sub: 'user-111', botId: 'bot-001' },
        { sub: 'user-222', botId: 'bot-002' },
      ],
    }); // GSI
    mockSend.mockResolvedValueOnce({ Item: bot1 }); // consistent get bot1
    mockSend.mockResolvedValueOnce({ Item: bot2 }); // consistent get bot2
    mockSend.mockResolvedValueOnce({}); // trade put bot1
    mockSend.mockResolvedValueOnce({}); // entryPrice bot1
    mockSend.mockResolvedValueOnce({}); // trade put bot2
    mockSend.mockResolvedValueOnce({}); // entryPrice bot2

    await handler(buildSnsEvent(indicators));

    // GSI + 2 gets + 2 trades + 2 entryPrices
    expect(mockSend).toHaveBeenCalledTimes(7);
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    expect(PutCommand).toHaveBeenCalledTimes(2);
    expect(PutCommand.mock.calls[0][0].Item.botId).toBe('bot-001');
    expect(PutCommand.mock.calls[1][0].Item.botId).toBe('bot-002');
  });
});
