import type { EventBridgeEvent } from 'aws-lambda';
import { SNSClient, SubscribeCommand, UnsubscribeCommand, SetSubscriptionAttributesCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { generateFilterPolicy } from '../filter-policy';
import type { BotAction, BotRecord, BotCreatedDetail, BotUpdatedDetail, BotDeletedDetail, RuleGroup } from '../types';

const sns = new SNSClient({});
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Returns the DynamoDB attribute name for a given action's subscription ARN.
 *
 * @param action - The bot action (buy or sell).
 * @returns The attribute name for the subscription ARN.
 */
function subscriptionArnField(action: BotAction): 'buySubscriptionArn' | 'sellSubscriptionArn' {
  return action === 'buy' ? 'buySubscriptionArn' : 'sellSubscriptionArn';
}

/**
 * Returns true if a bot needs a sell subscription due to stop-loss or take-profit
 * configuration, even without a sellQuery.
 *
 * @param bot - The bot record.
 * @returns True if SL/TP requires a sell subscription.
 */
function needsSellSubscriptionForSlTp(bot: BotRecord): boolean {
  return !!(bot.stopLoss || bot.takeProfit);
}

/**
 * Creates an SNS subscription for a single action (buy or sell) and stores
 * the subscription ARN on the bot record.
 *
 * @param bot - The bot record.
 * @param action - The action to subscribe (buy or sell).
 * @param query - The rule group for this action (optional for SL/TP sell subscriptions).
 */
async function subscribeAction(bot: BotRecord, action: BotAction, query?: RuleGroup): Promise<void> {
  const filterPolicy = generateFilterPolicy(bot.pair, query);

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
    const field = subscriptionArnField(action);
    await ddbDoc.send(new UpdateCommand({
      TableName: process.env.BOTS_TABLE_NAME!,
      Key: { sub: bot.sub, botId: bot.botId },
      UpdateExpression: `SET ${field} = :arn`,
      ExpressionAttributeValues: { ':arn': result.SubscriptionArn },
    }));
  }
}

/**
 * Removes an SNS subscription for a single action and clears the
 * subscription ARN from the bot record.
 *
 * @param subscriptionArn - The SNS subscription ARN to unsubscribe.
 * @param sub - The user sub.
 * @param botId - The bot ID.
 * @param action - The action whose subscription is being removed.
 */
async function unsubscribeAction(
  subscriptionArn: string,
  sub: string,
  botId: string,
  action: BotAction,
): Promise<void> {
  await sns.send(new UnsubscribeCommand({
    SubscriptionArn: subscriptionArn,
  }));

  const field = subscriptionArnField(action);
  await ddbDoc.send(new UpdateCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub, botId },
    UpdateExpression: `REMOVE ${field}`,
  }));
}

/**
 * Creates SNS subscriptions for all actions that need them. A sell
 * subscription is created if the bot has a sellQuery or if stop-loss /
 * take-profit is configured (even without a sellQuery).
 *
 * @param bot - The bot record to subscribe.
 */
async function subscribeBot(bot: BotRecord): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (bot.buyQuery) {
    tasks.push(subscribeAction(bot, 'buy', bot.buyQuery));
  }
  if (bot.sellQuery) {
    tasks.push(subscribeAction(bot, 'sell', bot.sellQuery));
  } else if (needsSellSubscriptionForSlTp(bot)) {
    // SL/TP needs a sell subscription even without a sellQuery (pair-only filter)
    tasks.push(subscribeAction(bot, 'sell'));
  }

  await Promise.all(tasks);
}

/**
 * Removes all active SNS subscriptions for a bot.
 *
 * @param bot - The bot record to unsubscribe.
 */
async function unsubscribeBot(bot: BotRecord): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (bot.buySubscriptionArn) {
    tasks.push(unsubscribeAction(bot.buySubscriptionArn, bot.sub, bot.botId, 'buy'));
  }
  if (bot.sellSubscriptionArn) {
    tasks.push(unsubscribeAction(bot.sellSubscriptionArn, bot.sub, bot.botId, 'sell'));
  }

  await Promise.all(tasks);
}

/**
 * Reconciles the SNS subscription for a single action based on current state.
 *
 * For sell actions, a subscription is also needed when stop-loss or take-profit
 * is configured, even without a sellQuery (uses pair-only filter policy).
 *
 * - Needs subscription + no current → create subscription
 * - No need + subscription exists → remove subscription
 * - Needs subscription + current exists → update filter policy
 *
 * @param bot - The bot record.
 * @param action - The action to reconcile (buy or sell).
 * @param query - The current rule group for this action (or undefined).
 * @param currentArn - The current subscription ARN (or undefined).
 */
async function reconcileAction(
  bot: BotRecord,
  action: BotAction,
  query: RuleGroup | undefined,
  currentArn: string | undefined,
): Promise<void> {
  // For sell, a subscription is needed if there's a query OR SL/TP
  const needsSubscription = action === 'sell'
    ? !!(query || needsSellSubscriptionForSlTp(bot))
    : !!query;

  if (needsSubscription && !currentArn) {
    // Subscription needed — create it
    await subscribeAction(bot, action, query);
  } else if (!needsSubscription && currentArn) {
    // No longer needed — unsubscribe
    await unsubscribeAction(currentArn, bot.sub, bot.botId, action);
  } else if (needsSubscription && currentArn) {
    // Still needed — update filter policy in-place
    const filterPolicy = generateFilterPolicy(bot.pair, query);
    await sns.send(new SetSubscriptionAttributesCommand({
      SubscriptionArn: currentArn,
      AttributeName: 'FilterPolicy',
      AttributeValue: JSON.stringify(filterPolicy),
    }));
  }
}

/**
 * EventBridge handler that manages per-action SNS subscriptions in response
 * to bot lifecycle events (BotCreated, BotUpdated, BotDeleted).
 *
 * Each bot maintains separate SNS subscriptions for buy and sell rules,
 * each with its own filter policy derived from the respective rule group.
 * This reduces false positive invocations of the bot executor Lambda.
 *
 * - BotCreated with active status: subscribe actions that have queries
 * - BotUpdated active→non-active: unsubscribe all
 * - BotUpdated non-active→active: subscribe actions that have queries
 * - BotUpdated queries changed while active: reconcile per-action subscriptions
 * - BotDeleted: unsubscribe all remaining subscriptions
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

      if (wasActive && !isActive) {
        // Deactivated — unsubscribe all
        await unsubscribeBot(bot);
      } else if (!wasActive && isActive) {
        // Activated — subscribe actions that have queries
        await subscribeBot(bot);
      } else if (wasActive && isActive && queriesChanged) {
        // Queries changed while active — reconcile each action independently
        await Promise.all([
          reconcileAction(bot, 'buy', bot.buyQuery, bot.buySubscriptionArn),
          reconcileAction(bot, 'sell', bot.sellQuery, bot.sellSubscriptionArn),
        ]);
      }
      break;
    }

    case 'BotDeleted': {
      const { buySubscriptionArn, sellSubscriptionArn } = event.detail as BotDeletedDetail;
      const tasks: Promise<void>[] = [];

      if (buySubscriptionArn) {
        tasks.push(sns.send(new UnsubscribeCommand({ SubscriptionArn: buySubscriptionArn })).then(() => {}));
      }
      if (sellSubscriptionArn) {
        tasks.push(sns.send(new UnsubscribeCommand({ SubscriptionArn: sellSubscriptionArn })).then(() => {}));
      }

      await Promise.all(tasks);
      break;
    }
  }
}
