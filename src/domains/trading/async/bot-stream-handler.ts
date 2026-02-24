import type { DynamoDBStreamEvent } from 'aws-lambda';
import { SNSClient, SubscribeCommand, UnsubscribeCommand, SetSubscriptionAttributesCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { generateFilterPolicy } from '../filter-policy';
import type { BotRecord } from '../types';

const sns = new SNSClient({});
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Creates an SNS subscription for the given bot and updates the bot
 * record with the subscription ARN.
 *
 * @param bot - The bot record to subscribe.
 */
async function subscribBot(bot: BotRecord): Promise<void> {
  const filterPolicy = generateFilterPolicy(bot.query, bot.pair);

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
 * Removes an SNS subscription for the given subscription ARN and clears
 * the subscription ARN from the bot record.
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
 * Checks whether a MODIFY event is only the subscriptionArn writeback
 * that this handler itself triggered. If so, the event should be ignored
 * to prevent an infinite loop.
 *
 * @param oldImage - The previous bot record.
 * @param newImage - The updated bot record.
 * @returns True if the only change is the subscriptionArn field.
 */
function isSubscriptionArnWriteback(oldImage: BotRecord, newImage: BotRecord): boolean {
  const oldArn = oldImage.subscriptionArn;
  const newArn = newImage.subscriptionArn;
  if (oldArn === newArn) return false;

  // Compare everything except subscriptionArn
  const { subscriptionArn: _a, ...oldRest } = oldImage;
  const { subscriptionArn: _b, ...newRest } = newImage;
  return JSON.stringify(oldRest) === JSON.stringify(newRest);
}

/**
 * DynamoDB Streams handler that manages SNS subscriptions in response
 * to bot create/update/delete events.
 *
 * - INSERT with active status: create subscription
 * - MODIFY active->paused/draft: unsubscribe
 * - MODIFY paused/draft->active: subscribe
 * - MODIFY query changed while active: update filter policy
 * - MODIFY only subscriptionArn changed: ignored (writeback from this handler)
 * - REMOVE: unsubscribe if subscribed
 *
 * @param event - The DynamoDB stream event.
 */
export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    const eventName = record.eventName;
    const newImage = record.dynamodb?.NewImage
      ? unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>) as BotRecord
      : undefined;
    const oldImage = record.dynamodb?.OldImage
      ? unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>) as BotRecord
      : undefined;

    if (eventName === 'INSERT' && newImage?.status === 'active') {
      await subscribBot(newImage);
    }

    if (eventName === 'MODIFY' && oldImage && newImage) {
      // Ignore the subscriptionArn writeback triggered by this handler
      if (isSubscriptionArnWriteback(oldImage, newImage)) continue;

      const wasActive = oldImage.status === 'active';
      const isActive = newImage.status === 'active';

      if (wasActive && !isActive && oldImage.subscriptionArn) {
        // Deactivated — unsubscribe
        await unsubscribeBot(oldImage.subscriptionArn, newImage.sub, newImage.botId);
      } else if (!wasActive && isActive) {
        // Activated — subscribe
        await subscribBot(newImage);
      } else if (wasActive && isActive && newImage.subscriptionArn) {
        // Query may have changed — update filter policy
        const queryChanged = JSON.stringify(oldImage.query) !== JSON.stringify(newImage.query);
        if (queryChanged) {
          const filterPolicy = generateFilterPolicy(newImage.query, newImage.pair);
          await sns.send(new SetSubscriptionAttributesCommand({
            SubscriptionArn: newImage.subscriptionArn,
            AttributeName: 'FilterPolicy',
            AttributeValue: JSON.stringify(filterPolicy),
          }));
        }
      }
    }

    if (eventName === 'REMOVE' && oldImage?.subscriptionArn) {
      await sns.send(new UnsubscribeCommand({
        SubscriptionArn: oldImage.subscriptionArn,
      }));
    }
  }
}
