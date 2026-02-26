import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainMarketStack}. */
export interface DomainMarketStackProps extends cdk.NestedStackProps {
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
 * Market domain stack.
 *
 * Owns market data ingestion and distribution. Creates the price history
 * DynamoDB table, an SNS topic for indicator distribution, a price
 * publisher Lambda (1-min EventBridge schedule), and a Cognito-protected
 * API route for price history queries.
 */
export class DomainMarketStack extends cdk.NestedStack {

  /** The price history DynamoDB table (exposed for cross-domain reads). */
  public readonly priceHistoryTable: dynamodb.Table;

  /** The SNS topic for indicator distribution (exposed for cross-domain subscriptions). */
  public readonly indicatorsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: DomainMarketStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'market');

    // ─── DynamoDB Tables ──────────────────────────────────────────

    this.priceHistoryTable = new dynamodb.Table(this, 'PriceHistoryTable', {
      tableName: `${props.name}-${props.environment}-market-price-history`,
      partitionKey: { name: 'pair', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // ─── SNS Topic ────────────────────────────────────────────────

    this.indicatorsTopic = new sns.Topic(this, 'IndicatorsTopic', {
      topicName: `${props.name}-${props.environment}-market-indicators`,
    });

    // ─── Lambda Functions ─────────────────────────────────────────

    // Market API handler — serves price history queries
    const handler = new NodejsFunction(this, 'MarketApiHandler', {
      functionName: `${props.name}-${props.environment}-market-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/market/index.ts'),
      handler: 'handler',
      environment: {
        PRICE_HISTORY_TABLE_NAME: this.priceHistoryTable.tableName,
      },
    });

    this.priceHistoryTable.grantReadData(handler);

    // Price Publisher handler — fetches market data and publishes indicators
    const pricePublisherHandler = new NodejsFunction(this, 'PricePublisherHandler', {
      functionName: `${props.name}-${props.environment}-market-price-publisher`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/market/async/price-publisher.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        SNS_TOPIC_ARN: this.indicatorsTopic.topicArn,
        PRICE_HISTORY_TABLE_NAME: this.priceHistoryTable.tableName,
      },
    });

    this.indicatorsTopic.grantPublish(pricePublisherHandler);
    this.priceHistoryTable.grantWriteData(pricePublisherHandler);

    // ─── EventBridge ──────────────────────────────────────────────

    new events.Rule(this, 'PricePublisherSchedule', {
      ruleName: `${props.name}-${props.environment}-market-price-schedule`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(pricePublisherHandler)],
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

    // /market/prices/{pair}
    const marketResource = props.api.root.addResource('market');
    const pricesResource = marketResource.addResource('prices');
    const pairResource = pricesResource.addResource('{pair}');
    pairResource.addCorsPreflight(corsOptions);
    pairResource.addMethod('GET', integration, methodOptions);
  }
}
