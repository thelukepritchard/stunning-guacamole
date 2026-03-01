import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
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
 * exchange (internal use), DynamoDB tables for demo balances, orders, and
 * exchange connections, a KMS key for credential encryption, two Lambda
 * handlers (public exchange proxy + internal demo exchange), and
 * Cognito-protected API routes under `/exchange` on the shared API.
 */
export class DomainExchangeStack extends cdk.NestedStack {

  /** The demo exchange REST API (exposed for internal references). */
  public readonly demoExchangeApi: apigateway.RestApi;

  /** The demo balances DynamoDB table (exposed for cross-domain references). */
  public readonly demoBalancesTable: dynamodb.Table;

  /** The demo orders DynamoDB table (exposed for cross-domain references). */
  public readonly demoOrdersTable: dynamodb.Table;

  /** The exchange connections DynamoDB table (exposed for cross-domain references). */
  public readonly connectionsTable: dynamodb.Table;

  /** The KMS key used to encrypt exchange credentials (exposed for cross-domain decrypt). */
  public readonly credentialsKey: kms.Key;

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

    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: `${props.name}-${props.environment}-exchange-connections`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── KMS Key for Exchange Credentials ──────────────────────────

    this.credentialsKey = new kms.Key(this, 'CredentialsKey', {
      alias: `${props.name}-${props.environment}-exchange-credentials`,
      description: 'Encrypts exchange API credentials at rest',
      enableKeyRotation: true,
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

    // ─── Demo Exchange API Routes (IAM-authenticated, internal only) ──

    const demoIntegration = new apigateway.LambdaIntegration(demoHandler);

    const demoMethodOptions: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.IAM,
    };

    const demoRoot = this.demoExchangeApi.root.addResource('demo-exchange');

    const demoBalanceResource = demoRoot.addResource('balance');
    demoBalanceResource.addMethod('GET', demoIntegration, demoMethodOptions);

    const demoPairsResource = demoRoot.addResource('pairs');
    demoPairsResource.addMethod('GET', demoIntegration, demoMethodOptions);

    const demoOrdersResource = demoRoot.addResource('orders');
    demoOrdersResource.addMethod('GET', demoIntegration, demoMethodOptions);
    demoOrdersResource.addMethod('POST', demoIntegration, demoMethodOptions);

    const demoOrderIdResource = demoOrdersResource.addResource('{orderId}');
    demoOrderIdResource.addMethod('DELETE', demoIntegration, demoMethodOptions);

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
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
        KMS_KEY_ID: this.credentialsKey.keyId,
      },
    });

    this.connectionsTable.grant(exchangeHandler,
      'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:Query',
    );
    this.credentialsKey.grant(exchangeHandler, 'kms:Encrypt', 'kms:Decrypt');

    // Grant exchange handler permission to invoke the IAM-authenticated demo exchange API
    exchangeHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: [this.demoExchangeApi.arnForExecuteApi('*', '/demo-exchange/*', '*')],
    }));

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

    // /exchange/connections
    const connectionsResource = exchangeResource.addResource('connections');
    connectionsResource.addCorsPreflight(corsOptions);
    connectionsResource.addMethod('POST', exchangeIntegration, methodOptions);
    connectionsResource.addMethod('GET', exchangeIntegration, methodOptions);

    // /exchange/connections/{connectionId}
    const connectionIdResource = connectionsResource.addResource('{connectionId}');
    connectionIdResource.addCorsPreflight(corsOptions);
    connectionIdResource.addMethod('DELETE', exchangeIntegration, methodOptions);

    // /exchange/active
    const activeResource = exchangeResource.addResource('active');
    activeResource.addCorsPreflight(corsOptions);
    activeResource.addMethod('PUT', exchangeIntegration, methodOptions);
    activeResource.addMethod('GET', exchangeIntegration, methodOptions);
  }
}
