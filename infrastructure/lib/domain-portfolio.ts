import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainPortfolioStack}. */
export interface DomainPortfolioStackProps extends cdk.NestedStackProps {

  /** Project name prefix for resource naming. */
  name: string;

  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;

  /** The REST API to attach the /portfolio resource to. */
  api: apigateway.RestApi;

  /** The Cognito authorizer to protect the /portfolio endpoint. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;

  /** The portfolio DynamoDB table (created in AuthStack, one record per user). */
  portfolioTable: dynamodb.Table;

  /** The bot performance DynamoDB table from the trading domain (for aggregation). */
  botPerformanceTable: dynamodb.Table;
}

/**
 * Portfolio domain stack.
 *
 * Creates a portfolio performance DynamoDB table, a performance recorder
 * Lambda (EventBridge 5-min schedule), an API handler Lambda, and wires
 * Cognito-protected API routes under `/portfolio` on the shared REST API.
 *
 * The portfolio table itself is created in AuthStack (to avoid circular
 * dependencies with the Cognito post-confirmation trigger).
 */
export class DomainPortfolioStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: DomainPortfolioStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'portfolio');

    // ─── DynamoDB Tables ──────────────────────────────────────────

    // Portfolio Performance table — stores aggregated P&L snapshots per user over time
    const portfolioPerformanceTable = new dynamodb.Table(this, 'PortfolioPerformanceTable', {
      tableName: `${props.name}-${props.environment}-portfolio-performance`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // ─── Lambda Functions ─────────────────────────────────────────

    // Portfolio API handler
    const handler = new NodejsFunction(this, 'PortfolioHandler', {
      functionName: `${props.name}-${props.environment}-portfolio-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/portfolio/index.ts'),
      handler: 'handler',
      environment: {
        PORTFOLIO_TABLE_NAME: props.portfolioTable.tableName,
        PORTFOLIO_PERFORMANCE_TABLE_NAME: portfolioPerformanceTable.tableName,
      },
    });

    props.portfolioTable.grantReadData(handler);
    portfolioPerformanceTable.grantReadData(handler);

    // Portfolio Performance Recorder handler
    const portfolioPerformanceRecorderHandler = new NodejsFunction(this, 'PortfolioPerformanceRecorderHandler', {
      functionName: `${props.name}-${props.environment}-portfolio-perf-recorder`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/portfolio/async/portfolio-performance-recorder.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        PORTFOLIO_TABLE_NAME: props.portfolioTable.tableName,
        PORTFOLIO_PERFORMANCE_TABLE_NAME: portfolioPerformanceTable.tableName,
        BOT_PERFORMANCE_TABLE_NAME: props.botPerformanceTable.tableName,
      },
    });

    props.portfolioTable.grantReadData(portfolioPerformanceRecorderHandler);
    portfolioPerformanceTable.grantReadWriteData(portfolioPerformanceRecorderHandler);
    props.botPerformanceTable.grantReadData(portfolioPerformanceRecorderHandler);

    // ─── EventBridge ──────────────────────────────────────────────

    new events.Rule(this, 'PortfolioPerformanceRecorderSchedule', {
      ruleName: `${props.name}-${props.environment}-portfolio-perf-recorder-schedule`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(portfolioPerformanceRecorderHandler)],
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

    const resource = props.api.root.addResource('portfolio');
    resource.addCorsPreflight(corsOptions);

    // GET /portfolio — get authenticated user's portfolio
    resource.addMethod('GET', integration, methodOptions);
    // POST /portfolio — create portfolio (placeholder)
    resource.addMethod('POST', integration, methodOptions);

    // /portfolio/performance
    const performanceResource = resource.addResource('performance');
    performanceResource.addCorsPreflight(corsOptions);
    // GET /portfolio/performance — portfolio P&L time series
    performanceResource.addMethod('GET', integration, methodOptions);

    // /portfolio/leaderboard
    const leaderboardResource = resource.addResource('leaderboard');
    leaderboardResource.addCorsPreflight(corsOptions);
    // GET /portfolio/leaderboard — top users by 24h profit
    leaderboardResource.addMethod('GET', integration, methodOptions);

    // /portfolio/leaderboard/{username}
    const traderProfileResource = leaderboardResource.addResource('{username}');
    traderProfileResource.addCorsPreflight(corsOptions);
    // GET /portfolio/leaderboard/{username} — public trader profile
    traderProfileResource.addMethod('GET', integration, methodOptions);

    // /portfolio/{id}
    const idResource = resource.addResource('{id}');
    idResource.addCorsPreflight(corsOptions);
    // GET /portfolio/{id} — get single portfolio
    idResource.addMethod('GET', integration, methodOptions);
    // PUT /portfolio/{id} — update portfolio
    idResource.addMethod('PUT', integration, methodOptions);
    // DELETE /portfolio/{id} — delete portfolio
    idResource.addMethod('DELETE', integration, methodOptions);
  }
}
