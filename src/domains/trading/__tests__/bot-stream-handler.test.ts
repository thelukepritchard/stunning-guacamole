import type { DynamoDBStreamEvent } from 'aws-lambda';
import type { BotRecord } from '../types';

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

import { handler } from '../async/bot-stream-handler';

/**
 * Tests for the bot stream handler Lambda.
 * Verifies that DynamoDB stream events for bot creates, updates, and deletes
 * trigger the correct SNS subscription management actions.
 */
describe('bot-stream-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SNS_TOPIC_ARN = 'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic';
    process.env.BOT_EXECUTOR_ARN = 'arn:aws:lambda:ap-southeast-2:123456789012:function:BotExecutor';
    process.env.BOTS_TABLE_NAME = 'BotsTable';
  });

  /**
   * Helper to build a DynamoDB stream event record.
   *
   * @param eventName - The event type (INSERT, MODIFY, REMOVE).
   * @param newImage - The new image of the bot record (optional).
   * @param oldImage - The old image of the bot record (optional).
   * @returns A DynamoDB stream event.
   */
  function buildStreamEvent(
    eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
    newImage?: Partial<BotRecord>,
    oldImage?: Partial<BotRecord>,
  ): DynamoDBStreamEvent {
    // Use require to avoid type conflicts between @aws-sdk and @types/aws-lambda AttributeValue
    const { marshall: m } = require('@aws-sdk/util-dynamodb');
    return {
      Records: [
        {
          eventID: 'evt-001',
          eventName,
          eventVersion: '1.1',
          eventSource: 'aws:dynamodb',
          awsRegion: 'ap-southeast-2',
          dynamodb: {
            Keys: m({ sub: newImage?.sub ?? oldImage?.sub ?? 'user-123', botId: newImage?.botId ?? oldImage?.botId ?? 'bot-001' }),
            NewImage: newImage ? m(newImage as Record<string, unknown>) : undefined,
            OldImage: oldImage ? m(oldImage as Record<string, unknown>) : undefined,
            StreamViewType: 'NEW_AND_OLD_IMAGES',
          },
          eventSourceARN: 'arn:aws:dynamodb:ap-southeast-2:123456789012:table/BotsTable/stream/2026-01-01',
        },
      ],
    } as unknown as DynamoDBStreamEvent;
  }

  /** Base bot record used across tests. */
  const baseBot: BotRecord = {
    sub: 'user-123',
    botId: 'bot-001',
    name: 'Test Bot',
    pair: 'BTC/USDT',
    action: 'buy',
    status: 'active',
    query: { combinator: 'and', rules: [{ field: 'price', operator: '>', value: '40000' }] },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  /**
   * Tests for INSERT events.
   */
  describe('INSERT events', () => {
    /** Verifies an INSERT with active status creates an SNS subscription. */
    it('subscribes when a new bot is inserted with active status', async () => {
      mockSnsSend.mockResolvedValueOnce({ SubscriptionArn: 'arn:aws:sns:sub-new' });
      mockDdbSend.mockResolvedValueOnce({});

      const event = buildStreamEvent('INSERT', { ...baseBot, status: 'active' });
      await handler(event);

      const { SubscribeCommand } = require('@aws-sdk/client-sns');
      expect(SubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TopicArn: 'arn:aws:sns:ap-southeast-2:123456789012:PriceTopic',
          Protocol: 'lambda',
          Endpoint: 'arn:aws:lambda:ap-southeast-2:123456789012:function:BotExecutor',
          ReturnSubscriptionArn: true,
        }),
      );
    });

    /** Verifies the subscription ARN is stored in the bot record. */
    it('updates bot record with subscription ARN after subscribing', async () => {
      mockSnsSend.mockResolvedValueOnce({ SubscriptionArn: 'arn:aws:sns:sub-new' });
      mockDdbSend.mockResolvedValueOnce({});

      const event = buildStreamEvent('INSERT', { ...baseBot, status: 'active' });
      await handler(event);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'BotsTable',
          Key: { sub: 'user-123', botId: 'bot-001' },
          UpdateExpression: 'SET subscriptionArn = :arn',
          ExpressionAttributeValues: { ':arn': 'arn:aws:sns:sub-new' },
        }),
      );
    });

    /** Verifies no subscription when INSERT is for a draft bot. */
    it('does not subscribe when bot status is draft', async () => {
      const event = buildStreamEvent('INSERT', { ...baseBot, status: 'draft' });
      await handler(event);

      expect(mockSnsSend).not.toHaveBeenCalled();
      expect(mockDdbSend).not.toHaveBeenCalled();
    });
  });

  /**
   * Tests for MODIFY events.
   */
  describe('MODIFY events', () => {
    /** Verifies unsubscribe when bot transitions from active to paused. */
    it('unsubscribes when bot changes from active to paused', async () => {
      mockSnsSend.mockResolvedValueOnce({});
      mockDdbSend.mockResolvedValueOnce({});

      const oldImage = { ...baseBot, status: 'active' as const, subscriptionArn: 'arn:aws:sns:sub-001' };
      const newImage = { ...baseBot, status: 'paused' as const };
      const event = buildStreamEvent('MODIFY', newImage, oldImage);

      await handler(event);

      const { UnsubscribeCommand } = require('@aws-sdk/client-sns');
      expect(UnsubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          SubscriptionArn: 'arn:aws:sns:sub-001',
        }),
      );
    });

    /** Verifies subscribe when bot transitions from paused to active. */
    it('subscribes when bot changes from paused to active', async () => {
      mockSnsSend.mockResolvedValueOnce({ SubscriptionArn: 'arn:aws:sns:sub-new' });
      mockDdbSend.mockResolvedValueOnce({});

      const oldImage = { ...baseBot, status: 'paused' as const };
      const newImage = { ...baseBot, status: 'active' as const };
      const event = buildStreamEvent('MODIFY', newImage, oldImage);

      await handler(event);

      const { SubscribeCommand } = require('@aws-sdk/client-sns');
      expect(SubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Protocol: 'lambda',
          ReturnSubscriptionArn: true,
        }),
      );
    });

    /** Verifies filter policy update when query changes while active. */
    it('updates filter policy when query changes while bot is active', async () => {
      mockSnsSend.mockResolvedValueOnce({});

      const oldImage = {
        ...baseBot,
        status: 'active' as const,
        subscriptionArn: 'arn:aws:sns:sub-001',
        query: { combinator: 'and' as const, rules: [{ field: 'price', operator: '>', value: '40000' }] },
      };
      const newImage = {
        ...baseBot,
        status: 'active' as const,
        subscriptionArn: 'arn:aws:sns:sub-001',
        query: { combinator: 'and' as const, rules: [{ field: 'price', operator: '>', value: '50000' }] },
      };
      const event = buildStreamEvent('MODIFY', newImage, oldImage);

      await handler(event);

      const { SetSubscriptionAttributesCommand } = require('@aws-sdk/client-sns');
      expect(SetSubscriptionAttributesCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          SubscriptionArn: 'arn:aws:sns:sub-001',
          AttributeName: 'FilterPolicy',
        }),
      );
    });

    /** Verifies no action when query has not changed while active. */
    it('does not update filter policy when query has not changed', async () => {
      const oldImage = {
        ...baseBot,
        status: 'active' as const,
        subscriptionArn: 'arn:aws:sns:sub-001',
      };
      const newImage = {
        ...baseBot,
        status: 'active' as const,
        subscriptionArn: 'arn:aws:sns:sub-001',
      };
      const event = buildStreamEvent('MODIFY', newImage, oldImage);

      await handler(event);

      const { SetSubscriptionAttributesCommand } = require('@aws-sdk/client-sns');
      expect(SetSubscriptionAttributesCommand).not.toHaveBeenCalled();
    });

    /** Verifies no action when the only change is the subscriptionArn writeback. */
    it('ignores subscriptionArn writeback from this handler', async () => {
      const oldImage = { ...baseBot, status: 'active' as const };
      const newImage = { ...baseBot, status: 'active' as const, subscriptionArn: 'arn:aws:sns:sub-new' };
      const event = buildStreamEvent('MODIFY', newImage, oldImage);

      await handler(event);

      expect(mockSnsSend).not.toHaveBeenCalled();
      expect(mockDdbSend).not.toHaveBeenCalled();
    });

    /** Verifies no action when subscriptionArn is cleared (writeback from unsubscribe). */
    it('ignores subscriptionArn removal writeback from this handler', async () => {
      const oldImage = { ...baseBot, status: 'paused' as const, subscriptionArn: 'arn:aws:sns:sub-old' };
      const newImage = { ...baseBot, status: 'paused' as const };
      const event = buildStreamEvent('MODIFY', newImage, oldImage);

      await handler(event);

      expect(mockSnsSend).not.toHaveBeenCalled();
      expect(mockDdbSend).not.toHaveBeenCalled();
    });

    /** Verifies no action when status remains paused. */
    it('takes no action when status remains paused', async () => {
      const oldImage = { ...baseBot, status: 'paused' as const };
      const newImage = { ...baseBot, status: 'paused' as const, name: 'Renamed Bot' };
      const event = buildStreamEvent('MODIFY', newImage, oldImage);

      await handler(event);

      expect(mockSnsSend).not.toHaveBeenCalled();
      expect(mockDdbSend).not.toHaveBeenCalled();
    });
  });

  /**
   * Tests for REMOVE events.
   */
  describe('REMOVE events', () => {
    /** Verifies unsubscribe when a bot with a subscription ARN is deleted. */
    it('unsubscribes when a subscribed bot is removed', async () => {
      mockSnsSend.mockResolvedValueOnce({});

      const oldImage = { ...baseBot, subscriptionArn: 'arn:aws:sns:sub-001' };
      const event = buildStreamEvent('REMOVE', undefined, oldImage);

      await handler(event);

      const { UnsubscribeCommand } = require('@aws-sdk/client-sns');
      expect(UnsubscribeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          SubscriptionArn: 'arn:aws:sns:sub-001',
        }),
      );
    });

    /** Verifies no action when a removed bot has no subscription ARN. */
    it('does not unsubscribe when removed bot has no subscription ARN', async () => {
      const oldImage = { ...baseBot };
      delete (oldImage as Partial<BotRecord>).subscriptionArn;
      const event = buildStreamEvent('REMOVE', undefined, oldImage);

      await handler(event);

      expect(mockSnsSend).not.toHaveBeenCalled();
    });
  });
});
