import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainBotsStack}. */
export interface DomainBotsStackProps extends cdk.NestedStackProps {
  /** Project name prefix for resource naming. */
  name: string;
  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;
  /** The REST API to attach routes to. */
  api: apigateway.RestApi;
  /** The Cognito authorizer to protect endpoints. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;
}

/**
 * Bots domain stack.
 *
 * Owns bot CRUD operations and user settings (exchange configuration).
 * Creates the bots and settings DynamoDB tables, a KMS key for
 * encrypting exchange API credentials, and wires Cognito-protected
 * API routes under `/bots` and `/settings`.
 *
 * The handler also needs cross-domain access to trades, bot-performance,
 * and backtests tables for bot deletion cleanup. These are referenced
 * by naming convention to avoid circular dependencies.
 */
export class DomainBotsStack extends cdk.NestedStack {

  /** The bots DynamoDB table (exposed for cross-domain references). */
  public readonly botsTable: dynamodb.Table;

  /** The settings DynamoDB table (exposed for cross-domain references). */
  public readonly settingsTable: dynamodb.Table;

  /** The KMS key for exchange credentials (exposed for cross-domain references). */
  public readonly exchangeKey: kms.Key;

  constructor(scope: Construct, id: string, props: DomainBotsStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'bots');

    // ─── DynamoDB Tables ──────────────────────────────────────────

    this.botsTable = new dynamodb.Table(this, 'BotsTable', {
      tableName: `${props.name}-${props.environment}-bots`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'botId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.botsTable.addGlobalSecondaryIndex({
      indexName: 'pair-status-index',
      partitionKey: { name: 'pair', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    });

    this.botsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    });

    this.settingsTable = new dynamodb.Table(this, 'SettingsTable', {
      tableName: `${props.name}-${props.environment}-bots-settings`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── KMS Key ──────────────────────────────────────────────────

    this.exchangeKey = new kms.Key(this, 'ExchangeCredentialsKey', {
      alias: `${props.name}-${props.environment}-bots-exchange-credentials`,
      description: 'Encrypts exchange API keys and secrets for the bots domain',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── Cross-domain table references (for bot deletion cleanup) ─

    const tradesTable = dynamodb.Table.fromTableName(
      this, 'TradesTableRef',
      `${props.name}-${props.environment}-executor-trades`,
    );

    const botPerformanceTable = dynamodb.Table.fromTableName(
      this, 'BotPerformanceTableRef',
      `${props.name}-${props.environment}-analytics-bot-performance`,
    );

    const backtestsTable = dynamodb.Table.fromTableName(
      this, 'BacktestsTableRef',
      `${props.name}-${props.environment}-backtesting-backtests`,
    );

    const backtestReportsBucket = s3.Bucket.fromBucketName(
      this, 'BacktestReportsBucketRef',
      `${props.name}-${props.environment}-backtesting-reports`,
    );

    // ─── Lambda Function ──────────────────────────────────────────

    const handler = new NodejsFunction(this, 'BotsApiHandler', {
      functionName: `${props.name}-${props.environment}-bots-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/bots/index.ts'),
      handler: 'handler',
      environment: {
        BOTS_TABLE_NAME: this.botsTable.tableName,
        SETTINGS_TABLE_NAME: this.settingsTable.tableName,
        KMS_KEY_ID: this.exchangeKey.keyId,
        TRADES_TABLE_NAME: tradesTable.tableName,
        BOT_PERFORMANCE_TABLE_NAME: botPerformanceTable.tableName,
        BACKTESTS_TABLE_NAME: backtestsTable.tableName,
        BACKTEST_REPORTS_BUCKET: backtestReportsBucket.bucketName,
      },
    });

    // Consolidated DynamoDB permissions
    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan',
        'dynamodb:BatchWriteItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem',
        'dynamodb:ConditionCheckItem', 'dynamodb:DescribeTable',
      ],
      resources: [
        this.botsTable.tableArn, `${this.botsTable.tableArn}/index/*`,
        this.settingsTable.tableArn, `${this.settingsTable.tableArn}/index/*`,
        tradesTable.tableArn, `${tradesTable.tableArn}/index/*`,
        botPerformanceTable.tableArn, `${botPerformanceTable.tableArn}/index/*`,
        backtestsTable.tableArn, `${backtestsTable.tableArn}/index/*`,
      ],
    }));

    this.exchangeKey.grantEncryptDecrypt(handler);
    backtestReportsBucket.grantDelete(handler);

    // EventBridge — publish BotCreated, BotUpdated, BotDeleted events
    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
    }));

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

    // /bots
    const botsResource = props.api.root.addResource('bots');
    botsResource.addCorsPreflight(corsOptions);
    botsResource.addMethod('GET', integration, methodOptions);
    botsResource.addMethod('POST', integration, methodOptions);

    // /bots/{botId}
    const botIdResource = botsResource.addResource('{botId}');
    botIdResource.addCorsPreflight(corsOptions);
    botIdResource.addMethod('GET', integration, methodOptions);
    botIdResource.addMethod('PUT', integration, methodOptions);
    botIdResource.addMethod('DELETE', integration, methodOptions);

    // /settings
    const settingsResource = props.api.root.addResource('settings');
    settingsResource.addCorsPreflight(corsOptions);
    settingsResource.addMethod('GET', integration, methodOptions);
    settingsResource.addMethod('PUT', integration, methodOptions);

    // /settings/exchange-options
    const exchangeOptionsResource = settingsResource.addResource('exchange-options');
    exchangeOptionsResource.addCorsPreflight(corsOptions);
    exchangeOptionsResource.addMethod('GET', integration, methodOptions);
  }
}
