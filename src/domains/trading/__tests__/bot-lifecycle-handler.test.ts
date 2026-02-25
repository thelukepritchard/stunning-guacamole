import type { EventBridgeEvent } from 'aws-lambda';
import type { BotRecord, BotCreatedDetail, BotUpdatedDetail, BotDeletedDetail } from '../types';

const mockSnsSend = jest.fn();
const mockDdbSend = jest.fn();

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({ send: mockSnsSend })),
  SubscribeCommand: jest.fn((params) => ({ ...params, _type: 'Subscribe' })),
  UnsubscribeCommand: jest.fn((params) => ({ ...params, _type: 'Unsubscribe' })),
  SetSubscriptionAttributesCommand: jest.fn((params) => ({ ...params, _type: 'SetSubscriptionAttributes' })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDdbSend })) },
  UpdateCommand: jest.fn((params) => ({ ...params, _type: 'Update' })),
}));

import { handler } from '../async/bot-lifecycle-handler';

/**
 * Tests for the bot lifecycle handler Lambda.
 * Verifies that EventBridge events for bot creates, updates, and deletes
 * trigger the correct per-action SNS subscription management.
 */
describe('bot-lifecycle-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SNS_TOPIC_ARN = 'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic';
    process.env.BOT_EXECUTOR_ARN = 'arn:aws:lambda:ap-southeast-2:123456789012:function:BotExecutor';
    process.env.BOTS_TABLE_NAME = 'BotsTable';
  });

  /** Base bot record used across tests. */
  const baseBot: BotRecord = {
    sub: 'user-123',
    botId: 'bot-001',
    name: 'Test Bot',
    pair: 'BTC/USDT',
    status: 'active',
    executionMode: 'condition_cooldown',
    buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  /**
   * Helper to build a mock EventBridge event.
   *
   * @param detailType - The detail type (BotCreated, BotUpdated, BotDeleted).
   * @param detail - The event detail payload.
   * @returns A mock EventBridge event.
   */
  function buildEvent<T>(detailType: string, detail: T): EventBridgeEvent<string, T> {
    return {
      version: '0',
      id: 'evt-001',
      source: 'signalr.trading',
      account: '123456789012',
      time: '2026-01-01T00:00:00Z',
      region: 'ap-southeast-2',
      resources: [],
      'detail-type': detailType,
      detail,
    };
  }

  /**
   * Tests for BotCreated events.
   */
  describe('BotCreated events', () => {
    /** Verifies no subscription when bot is created as draft. */
    it('does not subscribe when bot status is draft', async () => {
      const event = buildEvent<BotCreatedDetail>('BotCreated', {
        bot: { ...baseBot, status: 'draft' },
      });

      await handler(event);

      expect(mockSnsSend).not.toHaveBeenCalled();
      expect(mockDdbSend).not.toHaveBeenCalled();
    });

    /** Verifies buy subscription when bot is created with active status and buyQuery only. */
    it('creates buy subscription when bot is active with buyQuery', async () => {
      mockSnsSend.mockResolvedValueOnce({ SubscriptionArn: 'arn:aws:sns:buy-sub' });
      mockDdbSend.mockResolvedValueOnce({});

      const event = buildEvent<BotCreatedDetail>('BotCreated', {
        bot: { ...baseBot, status: 'active' },
      });

      await handler(event);

      const { SubscribeCommand } = require('@aws-sdk/client-sns');
      expect(SubscribeCommand).toHaveBeenCalledTimes(1);
      expect(SubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TopicArn: 'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic',
          Protocol: 'lambda',
          Endpoint: 'arn:aws:lambda:ap-southeast-2:123456789012:function:BotExecutor',
          ReturnSubscriptionArn: true,
        }),
      );
    });

    /** Verifies the buy subscription ARN is stored in the bot record. */
    it('updates bot record with buySubscriptionArn after subscribing', async () => {
      mockSnsSend.mockResolvedValueOnce({ SubscriptionArn: 'arn:aws:sns:buy-sub' });
      mockDdbSend.mockResolvedValueOnce({});

      const event = buildEvent<BotCreatedDetail>('BotCreated', {
        bot: { ...baseBot, status: 'active' },
      });

      await handler(event);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'BotsTable',
          Key: { sub: 'user-123', botId: 'bot-001' },
          UpdateExpression: 'SET buySubscriptionArn = :arn',
          ExpressionAttributeValues: { ':arn': 'arn:aws:sns:buy-sub' },
        }),
      );
    });

    /** Verifies both subscriptions when bot has both buyQuery and sellQuery. */
    it('creates both buy and sell subscriptions when bot has both queries', async () => {
      mockSnsSend.mockResolvedValueOnce({ SubscriptionArn: 'arn:aws:sns:buy-sub' });
      mockSnsSend.mockResolvedValueOnce({ SubscriptionArn: 'arn:aws:sns:sell-sub' });
      mockDdbSend.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({});

      const event = buildEvent<BotCreatedDetail>('BotCreated', {
        bot: {
          ...baseBot,
          status: 'active',
          sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '70' }] },
        },
      });

      await handler(event);

      const { SubscribeCommand } = require('@aws-sdk/client-sns');
      expect(SubscribeCommand).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * Tests for BotUpdated events.
   */
  describe('BotUpdated events', () => {
    /** Verifies unsubscribe when bot transitions from active to paused. */
    it('unsubscribes all when bot changes from active to paused', async () => {
      mockSnsSend.mockResolvedValue({});
      mockDdbSend.mockResolvedValue({});

      const event = buildEvent<BotUpdatedDetail>('BotUpdated', {
        bot: {
          ...baseBot,
          status: 'paused',
          buySubscriptionArn: 'arn:aws:sns:buy-sub',
          sellSubscriptionArn: 'arn:aws:sns:sell-sub',
        },
        previousStatus: 'active',
        queriesChanged: false,
      });

      await handler(event);

      const { UnsubscribeCommand } = require('@aws-sdk/client-sns');
      expect(UnsubscribeCommand).toHaveBeenCalledTimes(2);
      expect(UnsubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ SubscriptionArn: 'arn:aws:sns:buy-sub' }),
      );
      expect(UnsubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ SubscriptionArn: 'arn:aws:sns:sell-sub' }),
      );
    });

    /** Verifies subscribe when bot transitions from paused to active. */
    it('subscribes when bot changes from paused to active', async () => {
      mockSnsSend.mockResolvedValueOnce({ SubscriptionArn: 'arn:aws:sns:buy-sub' });
      mockDdbSend.mockResolvedValueOnce({});

      const event = buildEvent<BotUpdatedDetail>('BotUpdated', {
        bot: { ...baseBot, status: 'active' },
        previousStatus: 'paused',
        queriesChanged: false,
      });

      await handler(event);

      const { SubscribeCommand } = require('@aws-sdk/client-sns');
      expect(SubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Protocol: 'lambda',
          ReturnSubscriptionArn: true,
        }),
      );
    });

    /** Verifies filter policy update when queries change while active. */
    it('updates filter policy when queries change while bot is active', async () => {
      mockSnsSend.mockResolvedValueOnce({});

      const event = buildEvent<BotUpdatedDetail>('BotUpdated', {
        bot: {
          ...baseBot,
          status: 'active',
          buySubscriptionArn: 'arn:aws:sns:buy-sub',
          buyQuery: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '50000' }] },
        },
        previousStatus: 'active',
        queriesChanged: true,
      });

      await handler(event);

      const { SetSubscriptionAttributesCommand } = require('@aws-sdk/client-sns');
      expect(SetSubscriptionAttributesCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          SubscriptionArn: 'arn:aws:sns:buy-sub',
          AttributeName: 'FilterPolicy',
        }),
      );
    });

    /** Verifies a new subscription is created when a query is added while active. */
    it('creates subscription when query is added while active', async () => {
      mockSnsSend.mockResolvedValueOnce({}); // update buy filter policy
      mockSnsSend.mockResolvedValueOnce({ SubscriptionArn: 'arn:aws:sns:sell-sub' }); // new sell subscription
      mockDdbSend.mockResolvedValueOnce({}); // save sell ARN

      const event = buildEvent<BotUpdatedDetail>('BotUpdated', {
        bot: {
          ...baseBot,
          status: 'active',
          buySubscriptionArn: 'arn:aws:sns:buy-sub',
          sellQuery: { combinator: 'and', rules: [{ field: 'rsi_14', operator: '>', value: '70' }] },
          // no sellSubscriptionArn — new query added
        },
        previousStatus: 'active',
        queriesChanged: true,
      });

      await handler(event);

      const { SubscribeCommand, SetSubscriptionAttributesCommand } = require('@aws-sdk/client-sns');
      // Buy: update filter policy (existing subscription)
      expect(SetSubscriptionAttributesCommand).toHaveBeenCalledTimes(1);
      // Sell: new subscription
      expect(SubscribeCommand).toHaveBeenCalledTimes(1);
    });

    /** Verifies subscription is removed when query is removed while active. */
    it('unsubscribes when query is removed while active', async () => {
      mockSnsSend.mockResolvedValueOnce({}); // update buy filter policy
      mockSnsSend.mockResolvedValueOnce({}); // unsubscribe sell
      mockDdbSend.mockResolvedValueOnce({}); // remove sell ARN

      const event = buildEvent<BotUpdatedDetail>('BotUpdated', {
        bot: {
          ...baseBot,
          status: 'active',
          buySubscriptionArn: 'arn:aws:sns:buy-sub',
          sellSubscriptionArn: 'arn:aws:sns:sell-sub',
          // sellQuery is undefined — query removed
        },
        previousStatus: 'active',
        queriesChanged: true,
      });

      await handler(event);

      const { UnsubscribeCommand, SetSubscriptionAttributesCommand } = require('@aws-sdk/client-sns');
      // Buy: update filter policy
      expect(SetSubscriptionAttributesCommand).toHaveBeenCalledTimes(1);
      // Sell: unsubscribe
      expect(UnsubscribeCommand).toHaveBeenCalledTimes(1);
      expect(UnsubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ SubscriptionArn: 'arn:aws:sns:sell-sub' }),
      );
    });

    /** Verifies no action when queries have not changed while active. */
    it('does not update filter policy when queries have not changed', async () => {
      const event = buildEvent<BotUpdatedDetail>('BotUpdated', {
        bot: {
          ...baseBot,
          status: 'active',
          buySubscriptionArn: 'arn:aws:sns:buy-sub',
        },
        previousStatus: 'active',
        queriesChanged: false,
      });

      await handler(event);

      const { SetSubscriptionAttributesCommand } = require('@aws-sdk/client-sns');
      expect(SetSubscriptionAttributesCommand).not.toHaveBeenCalled();
    });

    /** Verifies no action when status remains paused. */
    it('takes no action when status remains paused', async () => {
      const event = buildEvent<BotUpdatedDetail>('BotUpdated', {
        bot: { ...baseBot, status: 'paused', name: 'Renamed Bot' },
        previousStatus: 'paused',
        queriesChanged: false,
      });

      await handler(event);

      expect(mockSnsSend).not.toHaveBeenCalled();
      expect(mockDdbSend).not.toHaveBeenCalled();
    });
  });

  /**
   * Tests for BotDeleted events.
   */
  describe('BotDeleted events', () => {
    /** Verifies unsubscribe when a bot with both subscriptions is deleted. */
    it('unsubscribes both when a fully subscribed bot is deleted', async () => {
      mockSnsSend.mockResolvedValue({});

      const event = buildEvent<BotDeletedDetail>('BotDeleted', {
        sub: 'user-123',
        botId: 'bot-001',
        buySubscriptionArn: 'arn:aws:sns:buy-sub',
        sellSubscriptionArn: 'arn:aws:sns:sell-sub',
      });

      await handler(event);

      const { UnsubscribeCommand } = require('@aws-sdk/client-sns');
      expect(UnsubscribeCommand).toHaveBeenCalledTimes(2);
      expect(UnsubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ SubscriptionArn: 'arn:aws:sns:buy-sub' }),
      );
      expect(UnsubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ SubscriptionArn: 'arn:aws:sns:sell-sub' }),
      );
    });

    /** Verifies only buy unsubscribe when deleted bot has only buy subscription. */
    it('unsubscribes only buy when deleted bot has only buySubscriptionArn', async () => {
      mockSnsSend.mockResolvedValueOnce({});

      const event = buildEvent<BotDeletedDetail>('BotDeleted', {
        sub: 'user-123',
        botId: 'bot-001',
        buySubscriptionArn: 'arn:aws:sns:buy-sub',
      });

      await handler(event);

      const { UnsubscribeCommand } = require('@aws-sdk/client-sns');
      expect(UnsubscribeCommand).toHaveBeenCalledTimes(1);
      expect(UnsubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ SubscriptionArn: 'arn:aws:sns:buy-sub' }),
      );
    });

    /** Verifies no action when a deleted bot has no subscription ARNs. */
    it('does not unsubscribe when deleted bot has no subscription ARNs', async () => {
      const event = buildEvent<BotDeletedDetail>('BotDeleted', {
        sub: 'user-123',
        botId: 'bot-001',
      });

      await handler(event);

      expect(mockSnsSend).not.toHaveBeenCalled();
    });
  });
});
