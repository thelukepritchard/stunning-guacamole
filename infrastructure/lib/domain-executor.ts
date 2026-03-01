import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainExecutorStack}. */
export interface DomainExecutorStackProps extends cdk.NestedStackProps {
  /** Project name prefix for resource naming. */
  name: string;
  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;
  /** The REST API to attach routes to. */
  api: apigateway.RestApi;
  /** The Cognito authorizer to protect endpoints. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;
  /** The bots DynamoDB table (for querying active bots). */
  botsTable: dynamodb.Table;
  /** The SNS topic for indicator distribution (executor subscribes). */
  indicatorsTopic: sns.Topic;
  /** The base URL of the demo exchange internal API. */
  demoExchangeApiUrl: string;
  /** The exchange connections table (for resolving real exchange credentials). */
  connectionsTable: dynamodb.Table;
  /** The KMS key for decrypting exchange API credentials. */
  credentialsKey: kms.Key;
}

/**
 * Executor domain stack.
 *
 * Owns trade execution — evaluates bot rules against market data and
 * records trades. Creates the trades DynamoDB table, a bot executor
 * Lambda (triggered via SNS subscription to market indicators), and
 * Cognito-protected API routes for trade queries.
 */
export class DomainExecutorStack extends cdk.NestedStack {

  /** The trades DynamoDB table (exposed for cross-domain reads). */
  public readonly tradesTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DomainExecutorStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'executor');

    // ─── DynamoDB Tables ──────────────────────────────────────────

    this.tradesTable = new dynamodb.Table(this, 'TradesTable', {
      tableName: `${props.name}-${props.environment}-executor-trades`,
      partitionKey: { name: 'botId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.tradesTable.addGlobalSecondaryIndex({
      indexName: 'sub-index',
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // ─── Lambda Functions ─────────────────────────────────────────

    // Executor API handler — serves trade queries
    const handler = new NodejsFunction(this, 'ExecutorApiHandler', {
      functionName: `${props.name}-${props.environment}-executor-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/executor/index.ts'),
      handler: 'handler',
      environment: {
        TRADES_TABLE_NAME: this.tradesTable.tableName,
        BOTS_TABLE_NAME: props.botsTable.tableName,
      },
    });

    this.tradesTable.grantReadData(handler);
    props.botsTable.grantReadData(handler);

    // Bot Executor handler — evaluates rules and records trades
    const botExecutorHandler = new NodejsFunction(this, 'BotExecutorHandler', {
      functionName: `${props.name}-${props.environment}-executor-bot-executor`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/executor/async/bot-executor.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        BOTS_TABLE_NAME: props.botsTable.tableName,
        TRADES_TABLE_NAME: this.tradesTable.tableName,
        DEMO_EXCHANGE_API_URL: props.demoExchangeApiUrl,
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        KMS_KEY_ID: props.credentialsKey.keyId,
      },
    });

    botExecutorHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:PutItem'],
      resources: [
        props.botsTable.tableArn, `${props.botsTable.tableArn}/index/*`,
        this.tradesTable.tableArn,
      ],
    }));

    props.connectionsTable.grantReadData(botExecutorHandler);
    props.credentialsKey.grantDecrypt(botExecutorHandler);

    // SNS subscription — bot executor receives indicator ticks
    props.indicatorsTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(botExecutorHandler),
    );

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

    // /trades
    const tradesResource = props.api.root.addResource('trades');
    tradesResource.addCorsPreflight(corsOptions);
    tradesResource.addMethod('GET', integration, methodOptions);

    // /trades/{botId}
    const tradeBotIdResource = tradesResource.addResource('{botId}');
    tradeBotIdResource.addCorsPreflight(corsOptions);
    tradeBotIdResource.addMethod('GET', integration, methodOptions);
  }
}
