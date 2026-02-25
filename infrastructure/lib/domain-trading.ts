import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainTradingStack}. */
export interface DomainTradingStackProps extends cdk.NestedStackProps {
  /** Project name prefix for resource naming. */
  name: string;
  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;
  /** The REST API to attach the /trading resource to. */
  api: apigateway.RestApi;
  /** The Cognito authorizer to protect the /trading endpoint. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;
}

/**
 * Trading domain stack.
 *
 * Creates DynamoDB tables (bots + trades), an SNS topic for indicator
 * distribution, four Lambda functions (API handler, price publisher,
 * bot executor, lifecycle handler), EventBridge scheduling and bot
 * lifecycle event routing, and wires Cognito-protected API routes
 * under `/trading`.
 */
export class DomainTradingStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: DomainTradingStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'trading');

    // ─── DynamoDB Tables ──────────────────────────────────────────

    const botsTable = new dynamodb.Table(this, 'BotsTable', {
      tableName: `${props.name}-${props.environment}-trading-bots`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'botId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    botsTable.addGlobalSecondaryIndex({
      indexName: 'subscriptionArn-index',
      partitionKey: { name: 'subscriptionArn', type: dynamodb.AttributeType.STRING },
    });

    const tradesTable = new dynamodb.Table(this, 'TradesTable', {
      tableName: `${props.name}-${props.environment}-trading-trades`,
      partitionKey: { name: 'botId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    tradesTable.addGlobalSecondaryIndex({
      indexName: 'sub-index',
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // ─── SNS Topic ────────────────────────────────────────────────

    const indicatorsTopic = new sns.Topic(this, 'IndicatorsTopic', {
      topicName: `${props.name}-${props.environment}-trading-indicators`,
    });

    // ─── Lambda Functions ─────────────────────────────────────────

    // Trading API handler
    const tradingApiHandler = new NodejsFunction(this, 'TradingApiHandler', {
      functionName: `${props.name}-${props.environment}-trading-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/domains/trading/index.ts'),
      handler: 'handler',
      environment: {
        BOTS_TABLE_NAME: botsTable.tableName,
        TRADES_TABLE_NAME: tradesTable.tableName,
      },
    });

    botsTable.grantReadWriteData(tradingApiHandler);
    tradesTable.grantReadWriteData(tradingApiHandler);

    // Grant the API handler permission to publish EventBridge events
    tradingApiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
    }));

    // Price Publisher handler
    const pricePublisherHandler = new NodejsFunction(this, 'PricePublisherHandler', {
      functionName: `${props.name}-${props.environment}-trading-price-publisher`,
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/domains/trading/async/price-publisher.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        SNS_TOPIC_ARN: indicatorsTopic.topicArn,
      },
    });

    indicatorsTopic.grantPublish(pricePublisherHandler);

    // Bot Executor handler
    const botExecutorHandler = new NodejsFunction(this, 'BotExecutorHandler', {
      functionName: `${props.name}-${props.environment}-trading-bot-executor`,
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/domains/trading/async/bot-executor.ts'),
      handler: 'handler',
      environment: {
        BOTS_TABLE_NAME: botsTable.tableName,
        TRADES_TABLE_NAME: tradesTable.tableName,
      },
    });

    botsTable.grant(botExecutorHandler, 'dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    tradesTable.grant(botExecutorHandler, 'dynamodb:PutItem');

    // Per-bot SNS subscriptions are created dynamically by the lifecycle handler.
    // Grant the SNS topic permission to invoke the executor Lambda.
    botExecutorHandler.addPermission('AllowSnsInvoke', {
      principal: new iam.ServicePrincipal('sns.amazonaws.com'),
      sourceArn: indicatorsTopic.topicArn,
    });

    // Bot Lifecycle Handler (manages SNS subscriptions via EventBridge events)
    const botLifecycleHandler = new NodejsFunction(this, 'BotLifecycleHandler', {
      functionName: `${props.name}-${props.environment}-trading-bot-lifecycle`,
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/domains/trading/async/bot-lifecycle-handler.ts'),
      handler: 'handler',
      environment: {
        SNS_TOPIC_ARN: indicatorsTopic.topicArn,
        BOT_EXECUTOR_ARN: botExecutorHandler.functionArn,
        BOTS_TABLE_NAME: botsTable.tableName,
      },
    });

    indicatorsTopic.grantPublish(botLifecycleHandler);
    botLifecycleHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sns:Subscribe', 'sns:Unsubscribe', 'sns:SetSubscriptionAttributes'],
      resources: [indicatorsTopic.topicArn],
    }));
    botsTable.grant(botLifecycleHandler, 'dynamodb:UpdateItem');

    // ─── EventBridge ──────────────────────────────────────────────

    new events.Rule(this, 'PricePublisherSchedule', {
      ruleName: `${props.name}-${props.environment}-trading-price-schedule`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(pricePublisherHandler)],
    });

    new events.Rule(this, 'BotLifecycleRule', {
      ruleName: `${props.name}-${props.environment}-trading-bot-lifecycle`,
      eventPattern: {
        source: ['signalr.trading'],
        detailType: ['BotCreated', 'BotUpdated', 'BotDeleted'],
      },
      targets: [new targets.LambdaFunction(botLifecycleHandler)],
    });

    // ─── API Gateway Routes ───────────────────────────────────────

    const integration = new apigateway.LambdaIntegration(tradingApiHandler);

    const methodOptions: apigateway.MethodOptions = {
      authorizer: props.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const corsOptions: apigateway.CorsOptions = {
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: apigateway.Cors.ALL_METHODS,
      allowHeaders: ['Content-Type', 'Authorization'],
    };

    const tradingResource = props.api.root.addResource('trading');

    // /trading/bots
    const botsResource = tradingResource.addResource('bots');
    botsResource.addCorsPreflight(corsOptions);
    // GET /trading/bots — list bots
    botsResource.addMethod('GET', integration, methodOptions);
    // POST /trading/bots — create bot
    botsResource.addMethod('POST', integration, methodOptions);

    // /trading/bots/{botId}
    const botIdResource = botsResource.addResource('{botId}');
    botIdResource.addCorsPreflight(corsOptions);
    // GET /trading/bots/{botId} — get single bot
    botIdResource.addMethod('GET', integration, methodOptions);
    // PUT /trading/bots/{botId} — update bot
    botIdResource.addMethod('PUT', integration, methodOptions);
    // DELETE /trading/bots/{botId} — delete bot
    botIdResource.addMethod('DELETE', integration, methodOptions);

    // /trading/trades
    const tradesResource = tradingResource.addResource('trades');
    tradesResource.addCorsPreflight(corsOptions);
    // GET /trading/trades — list all trades
    tradesResource.addMethod('GET', integration, methodOptions);

    // /trading/trades/{botId}
    const tradeBotIdResource = tradesResource.addResource('{botId}');
    tradeBotIdResource.addCorsPreflight(corsOptions);
    // GET /trading/trades/{botId} — list trades for a bot
    tradeBotIdResource.addMethod('GET', integration, methodOptions);
  }
}
