import type { EventBridgeEvent } from 'aws-lambda';
import { SNSClient, SubscribeCommand, UnsubscribeCommand, SetSubscriptionAttributesCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { generateFilterPolicy } from '../filter-policy';
import type { BotRecord, BotCreatedDetail, BotUpdatedDetail, BotDeletedDetail } from '../types';

const sns = new SNSClient({});
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Creates an SNS subscription for the given bot and updates the bot
 * record with the subscription ARN.
 *
 * @param bot - The bot record to subscribe.
 */
async function subscribeBot(bot: BotRecord): Promise<void> {
  const filterPolicy = generateFilterPolicy(bot.pair, bot.buyQuery, bot.sellQuery);

  const result = await sns.send(new SubscribeCommand({
    TopicArn: process.env.SNS_TOPIC_ARN!,
    Protocol: 'lambda',
    Endpoint: process.env.BOT_EXECUTOR_ARN!,
    Attributes: {
      FilterPolicy: JSON.stringify(filterPolicy),
      FilterPolicyScope: 'MessageAttributes',
    },
    ReturnSubscriptionArn: true,
  }));

  if (result.SubscriptionArn) {
    await ddbDoc.send(new UpdateCommand({
      TableName: process.env.BOTS_TABLE_NAME!,
      Key: { sub: bot.sub, botId: bot.botId },
      UpdateExpression: 'SET subscriptionArn = :arn',
      ExpressionAttributeValues: { ':arn': result.SubscriptionArn },
    }));
  }
}

/**
 * Removes an SNS subscription and clears the subscription ARN
 * from the bot record.
 *
 * @param subscriptionArn - The SNS subscription ARN to unsubscribe.
 * @param sub - The user sub.
 * @param botId - The bot ID.
 */
async function unsubscribeBot(subscriptionArn: string, sub: string, botId: string): Promise<void> {
  await sns.send(new UnsubscribeCommand({
    SubscriptionArn: subscriptionArn,
  }));

  await ddbDoc.send(new UpdateCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub, botId },
    UpdateExpression: 'REMOVE subscriptionArn',
  }));
}

/**
 * EventBridge handler that manages SNS subscriptions in response
 * to bot lifecycle events (BotCreated, BotUpdated, BotDeleted).
 *
 * - BotCreated with active status: create subscription
 * - BotUpdated active→non-active: unsubscribe
 * - BotUpdated non-active→active: subscribe
 * - BotUpdated queries changed while active: update filter policy
 * - BotDeleted: unsubscribe if subscribed
 *
 * @param event - The EventBridge event.
 */
export async function handler(
  event: EventBridgeEvent<string, BotCreatedDetail | BotUpdatedDetail | BotDeletedDetail>,
): Promise<void> {
  const detailType = event['detail-type'];

  switch (detailType) {
    case 'BotCreated': {
      const { bot } = event.detail as BotCreatedDetail;
      if (bot.status === 'active') {
        await subscribeBot(bot);
      }
      break;
    }

    case 'BotUpdated': {
      const { bot, previousStatus, queriesChanged } = event.detail as BotUpdatedDetail;
      const wasActive = previousStatus === 'active';
      const isActive = bot.status === 'active';

      if (wasActive && !isActive && bot.subscriptionArn) {
        // Deactivated — unsubscribe
        await unsubscribeBot(bot.subscriptionArn, bot.sub, bot.botId);
      } else if (!wasActive && isActive) {
        // Activated — subscribe
        await subscribeBot(bot);
      } else if (wasActive && isActive && bot.subscriptionArn && queriesChanged) {
        // Queries changed while active — update filter policy
        const filterPolicy = generateFilterPolicy(bot.pair, bot.buyQuery, bot.sellQuery);
        await sns.send(new SetSubscriptionAttributesCommand({
          SubscriptionArn: bot.subscriptionArn,
          AttributeName: 'FilterPolicy',
          AttributeValue: JSON.stringify(filterPolicy),
        }));
      }
      break;
    }

    case 'BotDeleted': {
      const { subscriptionArn } = event.detail as BotDeletedDetail;
      if (subscriptionArn) {
        await sns.send(new UnsubscribeCommand({
          SubscriptionArn: subscriptionArn,
        }));
      }
      break;
    }
  }
}
