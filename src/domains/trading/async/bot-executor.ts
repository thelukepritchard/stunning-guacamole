import type { SNSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { evaluateRuleGroup } from '../rule-evaluator';
import type { BotRecord, IndicatorSnapshot, TradeRecord } from '../types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * SNS-triggered Lambda that evaluates a bot's full rule tree against
 * incoming indicator data and records trade signals to DynamoDB.
 *
 * Each invocation corresponds to a single SNS subscription (one bot).
 *
 * @param event - The SNS event containing indicator data.
 */
export async function handler(event: SNSEvent): Promise<void> {
  for (const record of event.Records) {
    const subscriptionArn = record.EventSubscriptionArn;
    const indicators: IndicatorSnapshot = JSON.parse(record.Sns.Message);

    // Look up bot by subscription ARN
    const botResult = await ddbDoc.send(new QueryCommand({
      TableName: process.env.BOTS_TABLE_NAME!,
      IndexName: 'subscriptionArn-index',
      KeyConditionExpression: 'subscriptionArn = :arn',
      ExpressionAttributeValues: { ':arn': subscriptionArn },
    }));

    const bot = botResult.Items?.[0] as BotRecord | undefined;
    if (!bot || bot.status !== 'active') {
      console.log('Bot not found or not active:', { subscriptionArn });
      continue;
    }

    // Evaluate the full rule tree
    const match = evaluateRuleGroup(bot.query, indicators);
    if (!match) {
      console.log('Rules did not match:', { botId: bot.botId });
      continue;
    }

    // Record trade signal
    const trade: TradeRecord = {
      botId: bot.botId,
      timestamp: new Date().toISOString(),
      sub: bot.sub,
      pair: bot.pair,
      action: bot.action,
      price: indicators.price,
      indicators,
      createdAt: new Date().toISOString(),
    };

    await ddbDoc.send(new PutCommand({
      TableName: process.env.TRADES_TABLE_NAME!,
      Item: trade,
    }));

    console.log('Trade signal recorded:', { botId: bot.botId, action: bot.action, price: indicators.price });
  }
}
