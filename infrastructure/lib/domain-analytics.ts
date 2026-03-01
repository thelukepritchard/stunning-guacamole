import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainAnalyticsStack}. */
export interface DomainAnalyticsStackProps extends cdk.NestedStackProps {
  /** Project name prefix for resource naming. */
  name: string;
  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;
  /** The REST API to attach routes to. */
  api: apigateway.RestApi;
  /** The Cognito authorizer to protect endpoints. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;
  /** The portfolio DynamoDB table (created in AuthStack). */
  portfolioTable: dynamodb.Table;
  /** The bots DynamoDB table (for performance aggregation). */
  botsTable: dynamodb.Table;
  /** The trades DynamoDB table (for P&L calculations). */
  tradesTable: dynamodb.Table;
  /** The price history DynamoDB table (for unrealised P&L calculations). */
  priceHistoryTable: dynamodb.Table;
}

/**
 * Analytics domain stack.
 *
 * Owns performance tracking, leaderboard, and trader profiles. Creates
 * bot performance and portfolio performance DynamoDB tables, two
 * scheduled Lambda recorders (bot-level + portfolio-level P&L snapshots),
 * an API handler Lambda, and Cognito-protected API routes under `/analytics`.
 */
export class DomainAnalyticsStack extends cdk.NestedStack {

  /** The bot performance DynamoDB table (exposed for cross-domain reads). */
  public readonly botPerformanceTable: dynamodb.Table;

  /** The portfolio performance DynamoDB table. */
  public readonly portfolioPerformanceTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DomainAnalyticsStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'analytics');

    // ─── DynamoDB Tables ──────────────────────────────────────────

    this.botPerformanceTable = new dynamodb.Table(this, 'BotPerformanceTable', {
      tableName: `${props.name}-${props.environment}-analytics-bot-performance`,
      partitionKey: { name: 'botId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    this.botPerformanceTable.addGlobalSecondaryIndex({
      indexName: 'sub-index',
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    this.portfolioPerformanceTable = new dynamodb.Table(this, 'PortfolioPerformanceTable', {
      tableName: `${props.name}-${props.environment}-analytics-portfolio-performance`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // ─── Lambda Functions ─────────────────────────────────────────

    // Analytics API handler — serves performance, leaderboard, trader profile queries
    const handler = new NodejsFunction(this, 'AnalyticsApiHandler', {
      functionName: `${props.name}-${props.environment}-analytics-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/analytics/index.ts'),
      handler: 'handler',
      environment: {
        PORTFOLIO_TABLE_NAME: props.portfolioTable.tableName,
        PORTFOLIO_PERFORMANCE_TABLE_NAME: this.portfolioPerformanceTable.tableName,
        BOT_PERFORMANCE_TABLE_NAME: this.botPerformanceTable.tableName,
        BOTS_TABLE_NAME: props.botsTable.tableName,
      },
    });

    props.portfolioTable.grantReadData(handler);
    this.portfolioPerformanceTable.grantReadData(handler);
    this.botPerformanceTable.grantReadData(handler);
    props.botsTable.grantReadData(handler);

    // Bot Performance Recorder handler — computes per-bot P&L snapshots
    const botPerfRecorderHandler = new NodejsFunction(this, 'BotPerformanceRecorderHandler', {
      functionName: `${props.name}-${props.environment}-analytics-bot-perf-recorder`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/analytics/async/bot-performance-recorder.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        BOTS_TABLE_NAME: props.botsTable.tableName,
        TRADES_TABLE_NAME: props.tradesTable.tableName,
        BOT_PERFORMANCE_TABLE_NAME: this.botPerformanceTable.tableName,
        PRICE_HISTORY_TABLE_NAME: props.priceHistoryTable.tableName,
      },
    });

    props.botsTable.grantReadData(botPerfRecorderHandler);
    props.tradesTable.grantReadData(botPerfRecorderHandler);
    this.botPerformanceTable.grantWriteData(botPerfRecorderHandler);
    props.priceHistoryTable.grantReadData(botPerfRecorderHandler);

    // Explicit GSI grant for status-index on bots table
    botPerfRecorderHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${props.botsTable.tableArn}/index/status-index`],
    }));

    // Portfolio Performance Recorder handler — aggregates bot P&L into portfolio snapshots
    const portfolioPerfRecorderHandler = new NodejsFunction(this, 'PortfolioPerformanceRecorderHandler', {
      functionName: `${props.name}-${props.environment}-analytics-portfolio-perf-recorder`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/analytics/async/portfolio-performance-recorder.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        PORTFOLIO_TABLE_NAME: props.portfolioTable.tableName,
        PORTFOLIO_PERFORMANCE_TABLE_NAME: this.portfolioPerformanceTable.tableName,
        BOT_PERFORMANCE_TABLE_NAME: this.botPerformanceTable.tableName,
      },
    });

    props.portfolioTable.grantReadData(portfolioPerfRecorderHandler);
    this.portfolioPerformanceTable.grantReadWriteData(portfolioPerfRecorderHandler);
    this.botPerformanceTable.grantReadData(portfolioPerfRecorderHandler);

    // Explicit GSI grant — grantReadData covers the base table ARN only
    portfolioPerfRecorderHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${this.botPerformanceTable.tableArn}/index/sub-index`],
    }));

    // ─── EventBridge ──────────────────────────────────────────────

    new events.Rule(this, 'BotPerformanceRecorderSchedule', {
      ruleName: `${props.name}-${props.environment}-analytics-bot-perf-schedule`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(botPerfRecorderHandler)],
    });

    new events.Rule(this, 'PortfolioPerformanceRecorderSchedule', {
      ruleName: `${props.name}-${props.environment}-analytics-portfolio-perf-schedule`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(portfolioPerfRecorderHandler)],
    });

    // ─── API Gateway Routes ───────────────────────────────────────

    const integration = new apigateway.LambdaIntegration(handler);

    const methodOptions: apigateway.MethodOptions = {
      authorizer: props.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const corsOptions: apigateway.CorsOptions = {
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: apigateway.Cors.ALL_METHODS,
      allowHeaders: ['Content-Type', 'Authorization'],
    };

    // /analytics
    const analyticsResource = props.api.root.addResource('analytics');

    // /analytics/performance
    const performanceResource = analyticsResource.addResource('performance');
    performanceResource.addCorsPreflight(corsOptions);
    performanceResource.addMethod('GET', integration, methodOptions);

    // /analytics/bots/{botId}/performance
    const analyticsBotsResource = analyticsResource.addResource('bots');
    const analyticsBotIdResource = analyticsBotsResource.addResource('{botId}');
    const botPerformanceResource = analyticsBotIdResource.addResource('performance');
    botPerformanceResource.addCorsPreflight(corsOptions);
    botPerformanceResource.addMethod('GET', integration, methodOptions);

    // /analytics/leaderboard
    const leaderboardResource = analyticsResource.addResource('leaderboard');
    leaderboardResource.addCorsPreflight(corsOptions);
    leaderboardResource.addMethod('GET', integration, methodOptions);

    // /analytics/leaderboard/{username}
    const traderProfileResource = leaderboardResource.addResource('{username}');
    traderProfileResource.addCorsPreflight(corsOptions);
    traderProfileResource.addMethod('GET', integration, methodOptions);
  }
}
