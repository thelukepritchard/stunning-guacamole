import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainAccountStack}. */
export interface DomainAccountStackProps extends cdk.NestedStackProps {
  /** Project name prefix for resource naming. */
  name: string;
  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;
  /** The REST API to attach routes to. */
  api: apigateway.RestApi;
  /** The Cognito authorizer to protect endpoints. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;
  /** The Cognito User Pool (for admin user deletion). */
  userPool: cognito.UserPool;
}

/**
 * Account domain stack.
 *
 * Owns user feedback submission and account deletion. Creates a DynamoDB
 * feedback table, a Lambda handler, and wires Cognito-protected API routes
 * for `/feedback` and `/account`. Account deletion requires cross-domain
 * access to all user data tables (referenced by naming convention to avoid
 * circular dependencies).
 */
export class DomainAccountStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: DomainAccountStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'account');

    // ─── DynamoDB Tables ──────────────────────────────────────────

    const feedbackTable = new dynamodb.Table(this, 'FeedbackTable', {
      tableName: `${props.name}-${props.environment}-account-feedback`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── Cross-domain table references (for account deletion) ────

    const portfolioTable = dynamodb.Table.fromTableName(
      this, 'PortfolioTableRef',
      `${props.name}-${props.environment}-portfolio`,
    );
    const portfolioPerformanceTable = dynamodb.Table.fromTableName(
      this, 'PortfolioPerformanceTableRef',
      `${props.name}-${props.environment}-analytics-portfolio-performance`,
    );
    const tradingBotsTable = dynamodb.Table.fromTableName(
      this, 'TradingBotsTableRef',
      `${props.name}-${props.environment}-bots`,
    );
    const tradingTradesTable = dynamodb.Table.fromTableName(
      this, 'TradingTradesTableRef',
      `${props.name}-${props.environment}-executor-trades`,
    );
    const tradingBotPerformanceTable = dynamodb.Table.fromTableName(
      this, 'TradingBotPerformanceTableRef',
      `${props.name}-${props.environment}-analytics-bot-performance`,
    );
    const tradingSettingsTable = dynamodb.Table.fromTableName(
      this, 'TradingSettingsTableRef',
      `${props.name}-${props.environment}-bots-settings`,
    );
    const tradingBacktestsTable = dynamodb.Table.fromTableName(
      this, 'TradingBacktestsTableRef',
      `${props.name}-${props.environment}-backtesting-backtests`,
    );
    const demoBalancesTable = dynamodb.Table.fromTableName(
      this, 'DemoBalancesTableRef',
      `${props.name}-${props.environment}-exchange-demo-balances`,
    );
    const demoOrdersTable = dynamodb.Table.fromTableName(
      this, 'DemoOrdersTableRef',
      `${props.name}-${props.environment}-exchange-demo-orders`,
    );
    const exchangeConnectionsTable = dynamodb.Table.fromTableName(
      this, 'ExchangeConnectionsTableRef',
      `${props.name}-${props.environment}-exchange-connections`,
    );

    const backtestReportsBucket = s3.Bucket.fromBucketName(
      this, 'BacktestReportsBucketRef',
      `${props.name}-${props.environment}-backtesting-reports`,
    );

    // ─── Lambda Handler ──────────────────────────────────────────

    const handler = new NodejsFunction(this, 'AccountHandler', {
      functionName: `${props.name}-${props.environment}-account-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      entry: path.join(__dirname, '../../src/domains/account/index.ts'),
      handler: 'handler',
      environment: {
        FEEDBACK_TABLE_NAME: feedbackTable.tableName,
        PORTFOLIO_TABLE_NAME: portfolioTable.tableName,
        PORTFOLIO_PERFORMANCE_TABLE_NAME: portfolioPerformanceTable.tableName,
        TRADING_BOTS_TABLE_NAME: tradingBotsTable.tableName,
        TRADING_TRADES_TABLE_NAME: tradingTradesTable.tableName,
        TRADING_BOT_PERFORMANCE_TABLE_NAME: tradingBotPerformanceTable.tableName,
        TRADING_SETTINGS_TABLE_NAME: tradingSettingsTable.tableName,
        TRADING_BACKTESTS_TABLE_NAME: tradingBacktestsTable.tableName,
        DEMO_BALANCES_TABLE_NAME: demoBalancesTable.tableName,
        DEMO_ORDERS_TABLE_NAME: demoOrdersTable.tableName,
        EXCHANGE_CONNECTIONS_TABLE_NAME: exchangeConnectionsTable.tableName,
        BACKTEST_REPORTS_BUCKET_NAME: backtestReportsBucket.bucketName,
        USER_POOL_ID: props.userPool.userPoolId,
      },
    });

    // Feedback table
    feedbackTable.grant(handler, 'dynamodb:PutItem');

    // Account deletion — grant query + delete on all user data tables
    const allUserTables = [
      portfolioTable,
      portfolioPerformanceTable,
      tradingBotsTable,
      tradingTradesTable,
      tradingBotPerformanceTable,
      tradingSettingsTable,
      tradingBacktestsTable,
      demoBalancesTable,
      demoOrdersTable,
      exchangeConnectionsTable,
    ];

    for (const table of allUserTables) {
      table.grant(handler,
        'dynamodb:Query',
        'dynamodb:DeleteItem',
        'dynamodb:BatchWriteItem',
      );
    }

    // GSI query permissions for trades and bot-performance (sub-index)
    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [
        `${tradingTradesTable.tableArn}/index/sub-index`,
        `${tradingBotPerformanceTable.tableArn}/index/sub-index`,
      ],
    }));

    // S3 — list and delete backtest reports
    backtestReportsBucket.grantRead(handler);
    backtestReportsBucket.grantDelete(handler);

    // Cognito — admin disable + delete user
    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminDeleteUser',
      ],
      resources: [props.userPool.userPoolArn],
    }));

    // ─── API Gateway Routes ──────────────────────────────────────

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

    // /feedback
    const feedbackResource = props.api.root.addResource('feedback');
    feedbackResource.addCorsPreflight(corsOptions);
    feedbackResource.addMethod('POST', integration, methodOptions);

    // /account
    const accountResource = props.api.root.addResource('account');
    accountResource.addCorsPreflight(corsOptions);
    accountResource.addMethod('DELETE', integration, methodOptions);
  }
}
