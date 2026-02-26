import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
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
 * Creates DynamoDB tables (bots, trades, price history, bot performance,
 * exchange configs, backtests), an S3 bucket for backtest reports,
 * a KMS key for encrypting exchange API credentials, an SNS topic for
 * indicator distribution, seven Lambda functions (API handler, price
 * publisher, bot executor, performance recorder, backtest validate,
 * backtest engine, backtest write-report), an AWS Step Functions
 * workflow for backtest orchestration, EventBridge scheduling, and
 * wires Cognito-protected API routes under `/trading`.
 */
export class DomainTradingStack extends cdk.NestedStack {

  /** The bot performance DynamoDB table (exposed for cross-domain reads). */
  public readonly botPerformanceTable: dynamodb.Table;

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
      indexName: 'pair-status-index',
      partitionKey: { name: 'pair', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
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

    // Price History table — stores per-minute price data per pair
    const priceHistoryTable = new dynamodb.Table(this, 'PriceHistoryTable', {
      tableName: `${props.name}-${props.environment}-trading-price-history`,
      partitionKey: { name: 'pair', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Bot Performance table — stores P&L snapshots per bot over time
    const botPerformanceTable = new dynamodb.Table(this, 'BotPerformanceTable', {
      tableName: `${props.name}-${props.environment}-trading-bot-performance`,
      partitionKey: { name: 'botId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    this.botPerformanceTable = botPerformanceTable;

    // GSI for portfolio-level queries — get all performance snapshots for a user
    botPerformanceTable.addGlobalSecondaryIndex({
      indexName: 'sub-index',
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // Trading Settings table — stores exchange, base currency, and encrypted API credentials per user
    const settingsTable = new dynamodb.Table(this, 'SettingsTable', {
      tableName: `${props.name}-${props.environment}-trading-settings`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Backtests metadata table — stores backtest status and S3 key; full report lives in S3
    const backtestsTable = new dynamodb.Table(this, 'BacktestsTable', {
      tableName: `${props.name}-${props.environment}-trading-backtests`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'backtestId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    backtestsTable.addGlobalSecondaryIndex({
      indexName: 'botId-index',
      partitionKey: { name: 'botId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'testedAt', type: dynamodb.AttributeType.STRING },
    });

    // S3 bucket for backtest report JSON objects
    const backtestReportsBucket = new s3.Bucket(this, 'BacktestReportsBucket', {
      bucketName: `${props.name}-${props.environment}-backtest-reports`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // KMS key for encrypting exchange API credentials
    const exchangeKey = new kms.Key(this, 'ExchangeCredentialsKey', {
      alias: `${props.name}-${props.environment}-trading-exchange-credentials`,
      description: 'Encrypts exchange API keys and secrets for the trading domain',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
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
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/trading/index.ts'),
      handler: 'handler',
      environment: {
        BOTS_TABLE_NAME: botsTable.tableName,
        TRADES_TABLE_NAME: tradesTable.tableName,
        PRICE_HISTORY_TABLE_NAME: priceHistoryTable.tableName,
        BOT_PERFORMANCE_TABLE_NAME: botPerformanceTable.tableName,
        SETTINGS_TABLE_NAME: settingsTable.tableName,
        BACKTESTS_TABLE_NAME: backtestsTable.tableName,
        BACKTEST_REPORTS_BUCKET: backtestReportsBucket.bucketName,
        KMS_KEY_ID: exchangeKey.keyId,
      },
    });

    // Consolidated DynamoDB permissions to stay within the 20KB IAM policy limit.
    // Using a single PolicyStatement instead of individual grant*() calls reduces
    // the number of policy statements from ~10 to 1.
    tradingApiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan',
        'dynamodb:BatchWriteItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem',
        'dynamodb:ConditionCheckItem', 'dynamodb:DescribeTable',
      ],
      resources: [
        botsTable.tableArn, `${botsTable.tableArn}/index/*`,
        tradesTable.tableArn, `${tradesTable.tableArn}/index/*`,
        priceHistoryTable.tableArn, `${priceHistoryTable.tableArn}/index/*`,
        botPerformanceTable.tableArn, `${botPerformanceTable.tableArn}/index/*`,
        settingsTable.tableArn, `${settingsTable.tableArn}/index/*`,
        backtestsTable.tableArn, `${backtestsTable.tableArn}/index/*`,
      ],
    }));

    exchangeKey.grantEncryptDecrypt(tradingApiHandler);

    // Grant the API handler permission to read backtest reports from S3
    backtestReportsBucket.grantRead(tradingApiHandler);

    // Grant the API handler permission to delete backtest report S3 objects (bot deletion cleanup)
    backtestReportsBucket.grantDelete(tradingApiHandler);

    // Grant the API handler permission to publish EventBridge events
    tradingApiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
    }));

    // Price Publisher handler
    const pricePublisherHandler = new NodejsFunction(this, 'PricePublisherHandler', {
      functionName: `${props.name}-${props.environment}-trading-price-publisher`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/trading/async/price-publisher.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        SNS_TOPIC_ARN: indicatorsTopic.topicArn,
        PRICE_HISTORY_TABLE_NAME: priceHistoryTable.tableName,
      },
    });

    indicatorsTopic.grantPublish(pricePublisherHandler);
    priceHistoryTable.grantWriteData(pricePublisherHandler);

    // Bot Executor handler
    const botExecutorHandler = new NodejsFunction(this, 'BotExecutorHandler', {
      functionName: `${props.name}-${props.environment}-trading-bot-executor`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/trading/async/bot-executor.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        BOTS_TABLE_NAME: botsTable.tableName,
        TRADES_TABLE_NAME: tradesTable.tableName,
      },
    });

    botExecutorHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:PutItem'],
      resources: [
        botsTable.tableArn, `${botsTable.tableArn}/index/*`,
        tradesTable.tableArn,
      ],
    }));

    // Static SNS subscription — bot-executor receives all indicator ticks
    // and fans out to all active bots for the pair internally.
    indicatorsTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(botExecutorHandler),
    );

    // ─── EventBridge ──────────────────────────────────────────────

    new events.Rule(this, 'PricePublisherSchedule', {
      ruleName: `${props.name}-${props.environment}-trading-price-schedule`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(pricePublisherHandler)],
    });

    // Bot Performance Recorder handler
    const botPerformanceRecorderHandler = new NodejsFunction(this, 'BotPerformanceRecorderHandler', {
      functionName: `${props.name}-${props.environment}-trading-bot-perf-recorder`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/trading/async/bot-performance-recorder.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        BOTS_TABLE_NAME: botsTable.tableName,
        TRADES_TABLE_NAME: tradesTable.tableName,
        BOT_PERFORMANCE_TABLE_NAME: botPerformanceTable.tableName,
        PRICE_HISTORY_TABLE_NAME: priceHistoryTable.tableName,
      },
    });

    botsTable.grantReadData(botPerformanceRecorderHandler);
    tradesTable.grantReadData(botPerformanceRecorderHandler);
    botPerformanceTable.grantWriteData(botPerformanceRecorderHandler);
    priceHistoryTable.grantReadData(botPerformanceRecorderHandler);

    new events.Rule(this, 'BotPerformanceRecorderSchedule', {
      ruleName: `${props.name}-${props.environment}-trading-perf-recorder-schedule`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(botPerformanceRecorderHandler)],
    });

    // ─── Backtest Step Functions Workflow ──────────────────────────

    // Step 1: Validate and snapshot — checks tier, ownership, inflight
    const backtestValidateHandler = new NodejsFunction(this, 'BacktestValidateHandler', {
      functionName: `${props.name}-${props.environment}-trading-backtest-validate`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/trading/async/backtest-validate.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        BOTS_TABLE_NAME: botsTable.tableName,
        BACKTESTS_TABLE_NAME: backtestsTable.tableName,
      },
    });

    botsTable.grantReadData(backtestValidateHandler);
    backtestsTable.grant(backtestValidateHandler, 'dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:UpdateItem');

    // Step 3: Run backtest engine — replays price history through rule evaluator
    const backtestEngineHandler = new NodejsFunction(this, 'BacktestEngineHandler', {
      functionName: `${props.name}-${props.environment}-trading-backtest-engine`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/trading/async/backtest-engine.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(300),
      environment: {
        PRICE_HISTORY_TABLE_NAME: priceHistoryTable.tableName,
      },
    });

    priceHistoryTable.grantReadData(backtestEngineHandler);

    // Step 4: Write report — serialise to S3, update DynamoDB, enforce rolling cap
    const backtestWriteReportHandler = new NodejsFunction(this, 'BacktestWriteReportHandler', {
      functionName: `${props.name}-${props.environment}-trading-backtest-write-report`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/trading/async/backtest-write-report.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        BACKTESTS_TABLE_NAME: backtestsTable.tableName,
        BACKTEST_REPORTS_BUCKET: backtestReportsBucket.bucketName,
      },
    });

    backtestsTable.grant(backtestWriteReportHandler,
      'dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem');
    backtestReportsBucket.grantReadWrite(backtestWriteReportHandler);
    backtestReportsBucket.grantDelete(backtestWriteReportHandler);

    // Grant write-report handler permission to publish EventBridge events
    backtestWriteReportHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
    }));

    // Define Step Functions states
    const validateStep = new tasks.LambdaInvoke(this, 'ValidateAndSnapshot', {
      lambdaFunction: backtestValidateHandler,
      outputPath: '$.Payload',
    });

    const waitStep = new sfn.Wait(this, 'ArtificialDelay', {
      time: sfn.WaitTime.secondsPath('$.waitSeconds'),
    });

    const engineStep = new tasks.LambdaInvoke(this, 'RunBacktest', {
      lambdaFunction: backtestEngineHandler,
      outputPath: '$.Payload',
    });

    const writeReportStep = new tasks.LambdaInvoke(this, 'WriteReport', {
      lambdaFunction: backtestWriteReportHandler,
      outputPath: '$.Payload',
    });

    // Failure handler — updates DynamoDB status to 'failed'
    const failStep = new tasks.LambdaInvoke(this, 'HandleFailure', {
      lambdaFunction: backtestWriteReportHandler,
      payload: sfn.TaskInput.fromObject({
        failed: true,
        'error.$': '$.Error',
        'cause.$': '$.Cause',
        'backtestId.$': '$$.Execution.Input.backtestId',
        'sub.$': '$$.Execution.Input.sub',
      }),
      outputPath: '$.Payload',
    });

    // Chain with catch handlers
    const definition = validateStep
      .addCatch(failStep, { resultPath: '$.errorInfo' })
      .next(waitStep)
      .next(
        engineStep.addCatch(failStep, { resultPath: '$.errorInfo' }),
      )
      .next(
        writeReportStep.addCatch(failStep, { resultPath: '$.errorInfo' }),
      );

    const backtestWorkflow = new sfn.StateMachine(this, 'BacktestWorkflow', {
      stateMachineName: `${props.name}-${props.environment}-trading-backtest-workflow`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(15),
    });

    // Grant API handler permission to start Step Functions executions
    backtestWorkflow.grantStartExecution(tradingApiHandler);

    // Add workflow ARN to API handler environment
    tradingApiHandler.addEnvironment('BACKTEST_WORKFLOW_ARN', backtestWorkflow.stateMachineArn);

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

    // /trading/prices/{pair}
    const pricesResource = tradingResource.addResource('prices');
    const pricePairResource = pricesResource.addResource('{pair}');
    pricePairResource.addCorsPreflight(corsOptions);
    // GET /trading/prices/{pair} — price history for a pair
    pricePairResource.addMethod('GET', integration, methodOptions);

    // /trading/bots/{botId}/performance
    const botPerformanceResource = botIdResource.addResource('performance');
    botPerformanceResource.addCorsPreflight(corsOptions);
    // GET /trading/bots/{botId}/performance — bot P&L time series
    botPerformanceResource.addMethod('GET', integration, methodOptions);

    // /trading/settings
    const settingsResource = tradingResource.addResource('settings');
    settingsResource.addCorsPreflight(corsOptions);
    // GET /trading/settings — get trading settings
    settingsResource.addMethod('GET', integration, methodOptions);
    // PUT /trading/settings — update trading settings
    settingsResource.addMethod('PUT', integration, methodOptions);

    // /trading/settings/exchange-options
    const exchangeOptionsResource = settingsResource.addResource('exchange-options');
    exchangeOptionsResource.addCorsPreflight(corsOptions);
    // GET /trading/settings/exchange-options — list available exchanges and base currencies
    exchangeOptionsResource.addMethod('GET', integration, methodOptions);

    // /trading/bots/{botId}/backtests
    const backtestsResource = botIdResource.addResource('backtests');
    backtestsResource.addCorsPreflight(corsOptions);
    // POST /trading/bots/{botId}/backtests — submit a backtest
    backtestsResource.addMethod('POST', integration, methodOptions);
    // GET /trading/bots/{botId}/backtests — list backtests for a bot
    backtestsResource.addMethod('GET', integration, methodOptions);

    // /trading/bots/{botId}/backtests/latest
    const latestBacktestResource = backtestsResource.addResource('latest');
    latestBacktestResource.addCorsPreflight(corsOptions);
    // GET /trading/bots/{botId}/backtests/latest — get latest backtest (polling)
    latestBacktestResource.addMethod('GET', integration, methodOptions);

    // /trading/bots/{botId}/backtests/{backtestId}
    const backtestIdResource = backtestsResource.addResource('{backtestId}');
    backtestIdResource.addCorsPreflight(corsOptions);
    // GET /trading/bots/{botId}/backtests/{backtestId} — get full backtest report
    backtestIdResource.addMethod('GET', integration, methodOptions);
  }
}
