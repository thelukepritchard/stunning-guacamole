// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockSend }) },
  QueryCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Query' })),
  GetCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Get' })),
  PutCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Put' })),
  UpdateCommand: jest.fn().mockImplementation((params: object) => ({ ...params, _type: 'Update' })),
}));

import type { SNSEvent, SNSEventRecord } from 'aws-lambda';
import type { BotRecord, IndicatorSnapshot, RuleGroup } from '../../shared/types';
import { handler } from '../async/bot-executor';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal IndicatorSnapshot where price is always passable for rules.
 */
function buildIndicators(price = 50_000): IndicatorSnapshot {
  return {
    price,
    volume_24h: 1_000_000,
    price_change_pct: 0.5,
    rsi_14: 55,
    rsi_7: 53,
    macd_histogram: 0.1,
    macd_signal: 'bullish',
    sma_20: 49_000,
    sma_50: 48_000,
    sma_200: 45_000,
    ema_12: 50_100,
    ema_20: 49_500,
    ema_26: 49_000,
    bb_upper: 52_000,
    bb_lower: 48_000,
    bb_position: 'middle',
  };
}

/** A rule group that always evaluates to true (price > 0). */
const ALWAYS_TRUE_QUERY: RuleGroup = {
  combinator: 'and',
  rules: [{ field: 'price', operator: '>', value: '0' }],
};

/** A rule group that always evaluates to false (price > very high value). */
const ALWAYS_FALSE_QUERY: RuleGroup = {
  combinator: 'and',
  rules: [{ field: 'price', operator: '>', value: '999999999' }],
};

/**
 * Builds a minimal BotRecord for testing.
 */
function buildBot(overrides: Partial<BotRecord> = {}): BotRecord {
  return {
    sub: 'user-1',
    botId: 'bot-1',
    name: 'Test Bot',
    pair: 'BTC',
    status: 'active',
    executionMode: 'once_and_wait',
    buyQuery: ALWAYS_TRUE_QUERY,
    sellQuery: ALWAYS_TRUE_QUERY,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Builds a minimal SNSEvent record for a given pair and indicators.
 */
function buildSnsEvent(indicators: IndicatorSnapshot, pair = 'BTC'): SNSEvent {
  const record: SNSEventRecord = {
    EventSource: 'aws:sns',
    EventVersion: '1.0',
    EventSubscriptionArn: 'arn:aws:sns:ap-southeast-2:123456789012:test-topic:abcdef',
    Sns: {
      Type: 'Notification',
      MessageId: 'test-message-id',
      TopicArn: 'arn:aws:sns:ap-southeast-2:123456789012:test-topic',
      Subject: null as unknown as string,
      Message: JSON.stringify(indicators),
      Timestamp: '2024-01-01T00:00:00.000Z',
      SignatureVersion: '1',
      Signature: 'EXAMPLE',
      SigningCertUrl: 'https://example.com',
      UnsubscribeUrl: 'https://example.com',
      MessageAttributes: {
        pair: { Type: 'String', Value: pair },
      },
    },
  };
  return { Records: [record] };
}

/**
 * Configures mockSend to return an empty GSI page (no active bots) for the
 * initial QueryCommand fan-out.
 */
function mockNoBots(): void {
  mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
}

/**
 * Configures mockSend so that the GSI query returns one bot key, the Get
 * returns the full bot record, and the subsequent UpdateCommand (conditional
 * write) either succeeds (claimed = true) or rejects with
 * ConditionalCheckFailedException (claimed = false).
 *
 * The DDB call order inside the handler is:
 *   1. QueryCommand  — GSI page (pair-status-index)
 *   2. GetCommand    — strongly-consistent bot fetch
 *   3. UpdateCommand — conditional lastAction write (once_and_wait)
 *   4. PutCommand    — trade record
 *   5. UpdateCommand — entry price update
 *
 * Sell-only path (lastAction = 'buy') has the same sequence but may include an
 * additional UpdateCommand for entryPrice removal.
 */
function mockOneBotFlow(
  bot: BotRecord,
  conditionalWriteSucceeds = true,
): void {
  // 1. GSI page — one key
  mockSend.mockResolvedValueOnce({ Items: [{ sub: bot.sub, botId: bot.botId }], LastEvaluatedKey: undefined });
  // 2. Strongly-consistent get
  mockSend.mockResolvedValueOnce({ Item: bot });

  if (conditionalWriteSucceeds) {
    // 3. Conditional lastAction update — succeeds
    mockSend.mockResolvedValueOnce({});
    // 4. PutCommand for trade record
    mockSend.mockResolvedValueOnce({});
    // 5. UpdateCommand for entryPrice
    mockSend.mockResolvedValueOnce({});
  } else {
    const err = Object.assign(new Error('Condition failed'), { name: 'ConditionalCheckFailedException' });
    mockSend.mockRejectedValueOnce(err);
  }
}

// ─── isAllowedOnceAndWait via handler ─────────────────────────────────────────

describe('bot-executor — isAllowedOnceAndWait', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const { QueryCommand, GetCommand, PutCommand, UpdateCommand } = jest.requireMock(
      '@aws-sdk/lib-dynamodb',
    ) as {
      QueryCommand: jest.Mock;
      GetCommand: jest.Mock;
      PutCommand: jest.Mock;
      UpdateCommand: jest.Mock;
    };
    QueryCommand.mockImplementation((params: object) => ({ ...params, _type: 'Query' }));
    GetCommand.mockImplementation((params: object) => ({ ...params, _type: 'Get' }));
    PutCommand.mockImplementation((params: object) => ({ ...params, _type: 'Put' }));
    UpdateCommand.mockImplementation((params: object) => ({ ...params, _type: 'Update' }));

    process.env.BOTS_TABLE_NAME = 'bots-table';
    process.env.TRADES_TABLE_NAME = 'trades-table';
  });

  // ── fresh bot (no lastAction) ──────────────────────────────────────────────

  /**
   * A fresh bot (no lastAction) with a matching buyQuery should be allowed to
   * fire a buy trade — the conditional write is attempted.
   */
  it('should allow buy on a fresh bot with no lastAction', async () => {
    const bot = buildBot({ lastAction: undefined });
    mockOneBotFlow(bot, true);
    // sell path: bot has lastAction=undefined after the buy, but sellQuery will
    // evaluate — mockSend needs another full sequence for the sell evaluation.
    // However, after the buy fires the bot's in-memory lastAction is still
    // undefined (we don't re-fetch). The sell call to isAllowedOnceAndWait
    // checks the original bot.lastAction (undefined) → sell is NOT allowed
    // (changed behaviour). So only one conditional write should happen.
    // No extra mocks needed — mockSend for sell path will not be called.

    const indicators = buildIndicators();
    await handler(buildSnsEvent(indicators));

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    // One trade should be recorded (the buy)
    expect(PutCommand).toHaveBeenCalledTimes(1);
    const tradeItem = PutCommand.mock.calls[0][0].Item;
    expect(tradeItem.action).toBe('buy');
  });

  /**
   * A fresh bot (no lastAction) with a matching sellQuery must NOT fire a sell
   * trade. This is the key change — previously both buy and sell were allowed
   * on a fresh bot; now only buy is allowed.
   */
  it('should block sell on a fresh bot with no lastAction', async () => {
    // Bot has no buyQuery (so buy will not fire), but has a sellQuery that
    // always evaluates to true. With lastAction undefined, sell must be blocked.
    const bot = buildBot({
      lastAction: undefined,
      buyQuery: undefined,
      sellQuery: ALWAYS_TRUE_QUERY,
    });

    // GSI + Get mocks — no conditional write should be attempted for sell
    mockSend.mockResolvedValueOnce({ Items: [{ sub: bot.sub, botId: bot.botId }], LastEvaluatedKey: undefined });
    mockSend.mockResolvedValueOnce({ Item: bot });

    const indicators = buildIndicators();
    await handler(buildSnsEvent(indicators));

    const { PutCommand, UpdateCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as {
      PutCommand: jest.Mock;
      UpdateCommand: jest.Mock;
    };
    // No trade should be recorded and no conditional update attempted for sell
    expect(PutCommand).not.toHaveBeenCalled();
    // UpdateCommand would only be called for the conditional lastAction write
    // or entryPrice update — neither should happen
    expect(UpdateCommand).not.toHaveBeenCalled();
  });

  /**
   * When lastAction is 'buy', sell should be allowed (counter-action).
   */
  it('should allow sell when lastAction is buy', async () => {
    const bot = buildBot({ lastAction: 'buy', buyQuery: ALWAYS_FALSE_QUERY, sellQuery: ALWAYS_TRUE_QUERY });
    mockOneBotFlow(bot, true);

    const indicators = buildIndicators();
    await handler(buildSnsEvent(indicators));

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).toHaveBeenCalledTimes(1);
    const tradeItem = PutCommand.mock.calls[0][0].Item;
    expect(tradeItem.action).toBe('sell');
  });

  /**
   * When lastAction is 'buy', buy should be blocked (no duplicate buys).
   */
  it('should block buy when lastAction is buy', async () => {
    const bot = buildBot({ lastAction: 'buy', buyQuery: ALWAYS_TRUE_QUERY, sellQuery: ALWAYS_FALSE_QUERY });

    // GSI + Get only — no write should be attempted
    mockSend.mockResolvedValueOnce({ Items: [{ sub: bot.sub, botId: bot.botId }], LastEvaluatedKey: undefined });
    mockSend.mockResolvedValueOnce({ Item: bot });

    const indicators = buildIndicators();
    await handler(buildSnsEvent(indicators));

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).not.toHaveBeenCalled();
  });

  /**
   * When lastAction is 'sell', buy should be allowed (counter-action).
   */
  it('should allow buy when lastAction is sell', async () => {
    const bot = buildBot({ lastAction: 'sell', buyQuery: ALWAYS_TRUE_QUERY, sellQuery: ALWAYS_FALSE_QUERY });
    mockOneBotFlow(bot, true);

    const indicators = buildIndicators();
    await handler(buildSnsEvent(indicators));

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).toHaveBeenCalledTimes(1);
    const tradeItem = PutCommand.mock.calls[0][0].Item;
    expect(tradeItem.action).toBe('buy');
  });

  /**
   * When lastAction is 'sell', sell should be blocked.
   */
  it('should block sell when lastAction is sell', async () => {
    const bot = buildBot({ lastAction: 'sell', buyQuery: ALWAYS_FALSE_QUERY, sellQuery: ALWAYS_TRUE_QUERY });

    // GSI + Get only — sell should be blocked, buy has false query
    mockSend.mockResolvedValueOnce({ Items: [{ sub: bot.sub, botId: bot.botId }], LastEvaluatedKey: undefined });
    mockSend.mockResolvedValueOnce({ Item: bot });

    const indicators = buildIndicators();
    await handler(buildSnsEvent(indicators));

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).not.toHaveBeenCalled();
  });

  // ── conditional write race protection ─────────────────────────────────────

  /**
   * If the conditional write for lastAction is rejected (ConditionalCheckFailedException),
   * the trade must not be recorded.
   */
  it('should not record trade when conditional write is rejected', async () => {
    const bot = buildBot({ lastAction: undefined, sellQuery: undefined });
    mockOneBotFlow(bot, false);

    const indicators = buildIndicators();
    await handler(buildSnsEvent(indicators));

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).not.toHaveBeenCalled();
  });

  // ── missing pair attribute ──────────────────────────────────────────────────

  /**
   * Should skip processing when the SNS message has no pair attribute.
   */
  it('should skip processing when pair attribute is missing', async () => {
    const event = buildSnsEvent(buildIndicators());
    // Remove the pair attribute from the SNS message
    delete (event.Records[0].Sns.MessageAttributes as Record<string, unknown>)['pair'];

    await handler(event);

    // No DDB calls should be made
    expect(mockSend).not.toHaveBeenCalled();
  });

  // ── no active bots ─────────────────────────────────────────────────────────

  /**
   * When there are no active bots for the pair, handler should complete
   * without writing any trades.
   */
  it('should complete without trades when there are no active bots', async () => {
    mockNoBots();

    await handler(buildSnsEvent(buildIndicators()));

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).not.toHaveBeenCalled();
  });

  // ── buy rule does not match ────────────────────────────────────────────────

  /**
   * When buyQuery evaluates to false, no trade should fire even if
   * lastAction is undefined (fresh bot).
   */
  it('should not fire buy when buyQuery evaluates to false on fresh bot', async () => {
    const bot = buildBot({
      lastAction: undefined,
      buyQuery: ALWAYS_FALSE_QUERY,
      sellQuery: undefined,
    });

    mockSend.mockResolvedValueOnce({ Items: [{ sub: bot.sub, botId: bot.botId }], LastEvaluatedKey: undefined });
    mockSend.mockResolvedValueOnce({ Item: bot });

    await handler(buildSnsEvent(buildIndicators()));

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).not.toHaveBeenCalled();
  });
});

// ─── executeOnExchange / sizing / fetch paths ─────────────────────────────────

describe('bot-executor — executeOnExchange and sizing', () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();

    const { QueryCommand, GetCommand, PutCommand, UpdateCommand } = jest.requireMock(
      '@aws-sdk/lib-dynamodb',
    ) as {
      QueryCommand: jest.Mock;
      GetCommand: jest.Mock;
      PutCommand: jest.Mock;
      UpdateCommand: jest.Mock;
    };
    QueryCommand.mockImplementation((params: object) => ({ ...params, _type: 'Query' }));
    GetCommand.mockImplementation((params: object) => ({ ...params, _type: 'Get' }));
    PutCommand.mockImplementation((params: object) => ({ ...params, _type: 'Put' }));
    UpdateCommand.mockImplementation((params: object) => ({ ...params, _type: 'Update' }));

    process.env.BOTS_TABLE_NAME = 'bots-table';
    process.env.TRADES_TABLE_NAME = 'trades-table';
    process.env.DEMO_EXCHANGE_API_URL = 'https://demo.example.com/';

    // Spy on global fetch — real network must never be called in tests
    mockFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  /**
   * When buySizing is fixed, calculateOrderSize should compute size = value / price
   * and call placeExchangeOrder with the correct size — no balance fetch needed.
   */
  it('should place a fixed-size buy order without fetching balance', async () => {
    const bot = buildBot({
      lastAction: undefined,
      buySizing: { type: 'fixed', value: 500 }, // $500 fixed
    });
    mockOneBotFlow(bot, true);

    // fetch is called once — the POST to place-order
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    } as Response);

    const indicators = buildIndicators(50_000);
    await handler(buildSnsEvent(indicators));

    // fetch should be called exactly once: POST place-order (no balance fetch for fixed sizing)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('demo-exchange/orders');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { sub: string; pair: string; side: string; size: number };
    expect(body.sub).toBe('user-1');
    expect(body.pair).toBe('BTC');
    expect(body.side).toBe('buy');
    // $500 / $50,000 = 0.01 BTC
    expect(body.size).toBeCloseTo(0.01);

    // Trade must still be recorded
    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).toHaveBeenCalledTimes(1);
  });

  /**
   * When buySizing is percentage, calculateOrderSize fetches the current balance
   * first, then computes size = (usd * pct/100) / price.
   */
  it('should fetch balance and place a percentage-sized buy order', async () => {
    const bot = buildBot({
      lastAction: undefined,
      buySizing: { type: 'percentage', value: 50 }, // 50 % of USD balance
    });
    mockOneBotFlow(bot, true);

    // First fetch: GET balance
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ usd: 2000, btc: 0.1 }),
    } as Response);

    // Second fetch: POST place-order
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    } as Response);

    const indicators = buildIndicators(50_000);
    await handler(buildSnsEvent(indicators));

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call should be a GET to the balance endpoint
    const [balanceUrl] = mockFetch.mock.calls[0] as [string, RequestInit | undefined];
    expect(balanceUrl).toContain('demo-exchange/balance');
    expect(balanceUrl).toContain('sub=user-1');

    // Second call should be a POST to place the order
    const [orderUrl, orderInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(orderUrl).toContain('demo-exchange/orders');
    expect(orderInit.method).toBe('POST');
    const body = JSON.parse(orderInit.body as string) as { size: number };
    // $2000 * 50% = $1000, / $50,000 = 0.02 BTC
    expect(body.size).toBeCloseTo(0.02);
  });

  /**
   * When sellSizing is percentage, size = btc * pct/100.
   */
  it('should use BTC balance for percentage-sized sell order', async () => {
    const bot = buildBot({
      lastAction: 'buy',
      buyQuery: ALWAYS_FALSE_QUERY,
      sellQuery: ALWAYS_TRUE_QUERY,
      sellSizing: { type: 'percentage', value: 100 }, // 100% of BTC
    });
    mockOneBotFlow(bot, true);

    // Balance fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ usd: 0, btc: 0.5 }),
    } as Response);

    // Place order
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    } as Response);

    const indicators = buildIndicators(50_000);
    await handler(buildSnsEvent(indicators));

    const [, orderInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(orderInit.body as string) as { side: string; size: number };
    expect(body.side).toBe('sell');
    // 0.5 BTC * 100% = 0.5 BTC
    expect(body.size).toBeCloseTo(0.5);
  });

  /**
   * When the calculated order size is zero or negative (e.g. balance is $0 for a
   * percentage-sized buy), placeExchangeOrder must not be called.
   */
  it('should skip placing an order when calculated size is zero', async () => {
    const bot = buildBot({
      lastAction: undefined,
      buySizing: { type: 'percentage', value: 50 }, // 50% of $0 USD = 0 BTC
    });
    mockOneBotFlow(bot, true);

    // Balance fetch returns $0 USD
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ usd: 0, btc: 0 }),
    } as Response);

    const indicators = buildIndicators(50_000);
    await handler(buildSnsEvent(indicators));

    // Only the balance GET should have been called — no POST for the order
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    // Trade is still recorded even when order is skipped
    expect(PutCommand).toHaveBeenCalledTimes(1);
  });

  /**
   * When placeExchangeOrder receives a non-ok HTTP response, it must log the
   * error but NOT throw — the trade record should still be written.
   */
  it('should record trade even when the exchange order API returns an error', async () => {
    const bot = buildBot({
      lastAction: undefined,
      buySizing: { type: 'fixed', value: 100 },
    });
    mockOneBotFlow(bot, true);

    // POST to place-order fails with 500
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    const indicators = buildIndicators(50_000);
    await handler(buildSnsEvent(indicators));

    // Trade must still be recorded despite the exchange error
    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).toHaveBeenCalledTimes(1);
  });

  /**
   * When fetchDemoBalance returns a non-ok response, calculateOrderSize throws.
   * executeOnExchange catches the error internally — the trade should still be
   * recorded and the handler must not throw.
   */
  it('should still record trade when fetchDemoBalance fails', async () => {
    const bot = buildBot({
      lastAction: undefined,
      buySizing: { type: 'percentage', value: 50 },
    });

    // GSI + Get
    mockSend.mockResolvedValueOnce({ Items: [{ sub: bot.sub, botId: bot.botId }], LastEvaluatedKey: undefined });
    mockSend.mockResolvedValueOnce({ Item: bot });
    // Conditional write succeeds
    mockSend.mockResolvedValueOnce({});
    // PutCommand for trade record
    mockSend.mockResolvedValueOnce({});
    // UpdateCommand for entry price
    mockSend.mockResolvedValueOnce({});

    // Balance fetch fails
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'Bad Gateway',
    } as Response);

    const indicators = buildIndicators(50_000);
    await expect(handler(buildSnsEvent(indicators))).resolves.toBeUndefined();

    // Trade should still be recorded despite exchange failure
    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).toHaveBeenCalledTimes(1);
  });
});

// ─── handler — error resilience ───────────────────────────────────────────────

describe('bot-executor handler — error resilience', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const { QueryCommand, GetCommand, PutCommand, UpdateCommand } = jest.requireMock(
      '@aws-sdk/lib-dynamodb',
    ) as {
      QueryCommand: jest.Mock;
      GetCommand: jest.Mock;
      PutCommand: jest.Mock;
      UpdateCommand: jest.Mock;
    };
    QueryCommand.mockImplementation((params: object) => ({ ...params, _type: 'Query' }));
    GetCommand.mockImplementation((params: object) => ({ ...params, _type: 'Get' }));
    PutCommand.mockImplementation((params: object) => ({ ...params, _type: 'Put' }));
    UpdateCommand.mockImplementation((params: object) => ({ ...params, _type: 'Update' }));

    process.env.BOTS_TABLE_NAME = 'bots-table';
    process.env.TRADES_TABLE_NAME = 'trades-table';
  });

  /**
   * An unrecognised execution mode should be logged and skipped without
   * throwing or crashing the handler.
   */
  it('should skip bots with an unknown executionMode without throwing', async () => {
    const bot = buildBot({ executionMode: 'unknown_mode' as never });

    mockSend.mockResolvedValueOnce({ Items: [{ sub: bot.sub, botId: bot.botId }], LastEvaluatedKey: undefined });
    mockSend.mockResolvedValueOnce({ Item: bot });

    await expect(handler(buildSnsEvent(buildIndicators()))).resolves.toBeUndefined();

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    expect(PutCommand).not.toHaveBeenCalled();
  });

  /**
   * A malformed SNS message body (invalid JSON) should be caught and logged
   * without crashing the handler.
   */
  it('should handle malformed SNS message body without throwing', async () => {
    const event = buildSnsEvent(buildIndicators());
    event.Records[0].Sns.Message = 'not-valid-json{{{';

    await expect(handler(event)).resolves.toBeUndefined();
  });
});
