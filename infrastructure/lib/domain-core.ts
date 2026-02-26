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

/** Props for {@link DomainCoreStack}. */
export interface DomainCoreStackProps extends cdk.NestedStackProps {

  /** Project name prefix for resource naming. */
  name: string;

  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;

  /** The REST API to attach the /core resource to. */
  api: apigateway.RestApi;

  /** The Cognito authorizer to protect the /core endpoint. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;

  /** The Cognito User Pool (for admin user deletion). */
  userPool: cognito.UserPool;
}

/**
 * Core domain stack.
 *
 * Creates a DynamoDB feedback table, a Lambda function (bundled from
 * `src/domains/core/index.ts`), and wires it as a Cognito-protected
 * endpoint under `/core` on the shared REST API. Also handles
 * cross-domain account deletion with access to all user data stores.
 */
export class DomainCoreStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: DomainCoreStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'core');

    const feedbackTable = new dynamodb.Table(this, 'FeedbackTable', {
      tableName: `${props.name}-${props.environment}-feedback`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── Cross-domain table references (for account deletion) ──
    // Uses naming convention to avoid circular dependencies.

    const portfolioTable = dynamodb.Table.fromTableName(
      this, 'PortfolioTableRef',
      `${props.name}-${props.environment}-portfolio`,
    );
    const portfolioPerformanceTable = dynamodb.Table.fromTableName(
      this, 'PortfolioPerformanceTableRef',
      `${props.name}-${props.environment}-portfolio-performance`,
    );
    const tradingBotsTable = dynamodb.Table.fromTableName(
      this, 'TradingBotsTableRef',
      `${props.name}-${props.environment}-trading-bots`,
    );
    const tradingTradesTable = dynamodb.Table.fromTableName(
      this, 'TradingTradesTableRef',
      `${props.name}-${props.environment}-trading-trades`,
    );
    const tradingBotPerformanceTable = dynamodb.Table.fromTableName(
      this, 'TradingBotPerformanceTableRef',
      `${props.name}-${props.environment}-trading-bot-performance`,
    );
    const tradingSettingsTable = dynamodb.Table.fromTableName(
      this, 'TradingSettingsTableRef',
      `${props.name}-${props.environment}-trading-settings`,
    );
    const tradingBacktestsTable = dynamodb.Table.fromTableName(
      this, 'TradingBacktestsTableRef',
      `${props.name}-${props.environment}-trading-backtests`,
    );
    const demoBalancesTable = dynamodb.Table.fromTableName(
      this, 'DemoBalancesTableRef',
      `${props.name}-${props.environment}-demo-exchange-balances`,
    );
    const demoOrdersTable = dynamodb.Table.fromTableName(
      this, 'DemoOrdersTableRef',
      `${props.name}-${props.environment}-demo-exchange-orders`,
    );

    const backtestReportsBucket = s3.Bucket.fromBucketName(
      this, 'BacktestReportsBucketRef',
      `${props.name}-${props.environment}-backtest-reports`,
    );

    // ─── Lambda Handler ────────────────────────────────────────

    const handler = new NodejsFunction(this, 'CoreHandler', {
      functionName: `${props.name}-${props.environment}-core-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      entry: path.join(__dirname, '../../src/domains/core/index.ts'),
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
        BACKTEST_REPORTS_BUCKET_NAME: backtestReportsBucket.bucketName,
        USER_POOL_ID: props.userPool.userPoolId,
      },
    });

    // Feedback table — existing permission
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

    // ─── API Gateway Routes ────────────────────────────────────

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

    const resource = props.api.root.addResource('core');
    const feedbackResource = resource.addResource('feedback');
    feedbackResource.addCorsPreflight(corsOptions);

    // POST /core/feedback — submit user feedback
    feedbackResource.addMethod('POST', integration, methodOptions);

    // DELETE /core/account — delete user account and all data
    const accountResource = resource.addResource('account');
    accountResource.addCorsPreflight(corsOptions);
    accountResource.addMethod('DELETE', integration, methodOptions);
  }
}
