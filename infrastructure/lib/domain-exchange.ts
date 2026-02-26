import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainExchangeStack}. */
export interface DomainExchangeStackProps extends cdk.NestedStackProps {
  /** Project name prefix for resource naming. */
  name: string;
  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;
  /** The shared REST API to attach public exchange routes to. */
  api: apigateway.RestApi;
  /** The Cognito authorizer to protect public exchange endpoints. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;
}

/**
 * Exchange domain stack.
 *
 * Merges the former orderbook (exchange proxy) and demo-exchange domains.
 * Creates a standalone unauthenticated regional REST API for the demo
 * exchange (internal use), DynamoDB tables for demo balances and orders,
 * two Lambda handlers (public exchange proxy + internal demo exchange),
 * and Cognito-protected API routes under `/exchange` on the shared API.
 */
export class DomainExchangeStack extends cdk.NestedStack {

  /** The demo exchange REST API (exposed for internal references). */
  public readonly demoExchangeApi: apigateway.RestApi;

  /** The demo balances DynamoDB table (exposed for cross-domain references). */
  public readonly demoBalancesTable: dynamodb.Table;

  /** The demo orders DynamoDB table (exposed for cross-domain references). */
  public readonly demoOrdersTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DomainExchangeStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'exchange');

    // ══════════════════════════════════════════════════════════════
    // Demo Exchange (internal, unauthenticated regional API)
    // ══════════════════════════════════════════════════════════════

    this.demoExchangeApi = new apigateway.RestApi(this, 'DemoExchangeApi', {
      restApiName: `${props.name}-${props.environment}-demo-exchange-api`,
      endpointTypes: [apigateway.EndpointType.REGIONAL],
    });

    // ─── DynamoDB Tables ──────────────────────────────────────────

    this.demoBalancesTable = new dynamodb.Table(this, 'BalancesTable', {
      tableName: `${props.name}-${props.environment}-exchange-demo-balances`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.demoOrdersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: `${props.name}-${props.environment}-exchange-demo-orders`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── Demo Exchange Lambda ─────────────────────────────────────

    const demoHandler = new NodejsFunction(this, 'DemoExchangeHandler', {
      functionName: `${props.name}-${props.environment}-exchange-demo-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/exchange/demo/index.ts'),
      handler: 'handler',
      environment: {
        BALANCES_TABLE_NAME: this.demoBalancesTable.tableName,
        ORDERS_TABLE_NAME: this.demoOrdersTable.tableName,
      },
    });

    this.demoBalancesTable.grant(demoHandler, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem');
    this.demoOrdersTable.grant(demoHandler, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query');

    // ─── Demo Exchange API Routes ─────────────────────────────────

    const demoIntegration = new apigateway.LambdaIntegration(demoHandler);

    const demoCorsOptions: apigateway.CorsOptions = {
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: apigateway.Cors.ALL_METHODS,
      allowHeaders: ['Content-Type'],
    };

    const demoRoot = this.demoExchangeApi.root.addResource('demo-exchange');

    const demoBalanceResource = demoRoot.addResource('balance');
    demoBalanceResource.addCorsPreflight(demoCorsOptions);
    demoBalanceResource.addMethod('GET', demoIntegration);

    const demoPairsResource = demoRoot.addResource('pairs');
    demoPairsResource.addCorsPreflight(demoCorsOptions);
    demoPairsResource.addMethod('GET', demoIntegration);

    const demoOrdersResource = demoRoot.addResource('orders');
    demoOrdersResource.addCorsPreflight(demoCorsOptions);
    demoOrdersResource.addMethod('GET', demoIntegration);
    demoOrdersResource.addMethod('POST', demoIntegration);

    const demoOrderIdResource = demoOrdersResource.addResource('{orderId}');
    demoOrderIdResource.addCorsPreflight(demoCorsOptions);
    demoOrderIdResource.addMethod('DELETE', demoIntegration);

    // ══════════════════════════════════════════════════════════════
    // Public Exchange Proxy (authenticated, shared API)
    // ══════════════════════════════════════════════════════════════

    const exchangeHandler = new NodejsFunction(this, 'ExchangeHandler', {
      functionName: `${props.name}-${props.environment}-exchange-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      entry: path.join(__dirname, '../../src/domains/exchange/index.ts'),
      handler: 'handler',
      environment: {
        DEMO_EXCHANGE_API_URL: this.demoExchangeApi.url,
      },
    });

    const exchangeIntegration = new apigateway.LambdaIntegration(exchangeHandler);

    const methodOptions: apigateway.MethodOptions = {
      authorizer: props.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const corsOptions: apigateway.CorsOptions = {
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: apigateway.Cors.ALL_METHODS,
      allowHeaders: ['Content-Type', 'Authorization'],
    };

    // /exchange
    const exchangeResource = props.api.root.addResource('exchange');
    exchangeResource.addCorsPreflight(corsOptions);

    // /exchange/balance
    const balanceResource = exchangeResource.addResource('balance');
    balanceResource.addCorsPreflight(corsOptions);
    balanceResource.addMethod('GET', exchangeIntegration, methodOptions);

    // /exchange/pairs
    const pairsResource = exchangeResource.addResource('pairs');
    pairsResource.addCorsPreflight(corsOptions);
    pairsResource.addMethod('GET', exchangeIntegration, methodOptions);

    // /exchange/orders
    const ordersResource = exchangeResource.addResource('orders');
    ordersResource.addCorsPreflight(corsOptions);
    ordersResource.addMethod('GET', exchangeIntegration, methodOptions);

    // /exchange/orders/{orderId}
    const orderIdResource = ordersResource.addResource('{orderId}');
    orderIdResource.addCorsPreflight(corsOptions);
    orderIdResource.addMethod('DELETE', exchangeIntegration, methodOptions);
  }
}
