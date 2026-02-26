import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainDemoExchangeStack}. */
export interface DomainDemoExchangeStackProps extends cdk.NestedStackProps {

  /** Project name prefix for resource naming. */
  name: string;

  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;
}

/**
 * Demo exchange domain stack.
 *
 * Creates a standalone REST API (unauthenticated) that simulates exchange
 * behaviour for demo-mode users. Includes DynamoDB tables for balances and
 * orders, plus a Lambda handler wired to the API.
 *
 * The API is REGIONAL (no CloudFront) since it is called internally by
 * the Orderbook domain, not directly by end users.
 */
export class DomainDemoExchangeStack extends cdk.NestedStack {

  /** The demo exchange REST API — exposed so the Orderbook stack can reference its URL. */
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: DomainDemoExchangeStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'demo-exchange');

    // ── API Gateway (unauthenticated, regional) ──────────────────
    // NOTE: This API is intentionally unauthenticated for Phase 1.
    // It handles demo (fake) balances only — no real money is at risk.
    // TODO: Convert to a VPC-private API or add IAM/API-key auth when
    //       the orderbook begins routing real exchange traffic.

    this.api = new apigateway.RestApi(this, 'DemoExchangeApi', {
      restApiName: `${props.name}-${props.environment}-demo-exchange-api`,
      endpointTypes: [apigateway.EndpointType.REGIONAL],
    });

    // ── DynamoDB Tables ──────────────────────────────────────────

    const balancesTable = new dynamodb.Table(this, 'BalancesTable', {
      tableName: `${props.name}-${props.environment}-demo-exchange-balances`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: `${props.name}-${props.environment}-demo-exchange-orders`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Lambda Function ──────────────────────────────────────────

    const handler = new NodejsFunction(this, 'DemoExchangeHandler', {
      functionName: `${props.name}-${props.environment}-demo-exchange-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/demo-exchange/index.ts'),
      handler: 'handler',
      environment: {
        BALANCES_TABLE_NAME: balancesTable.tableName,
        ORDERS_TABLE_NAME: ordersTable.tableName,
      },
    });

    balancesTable.grant(handler, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem');
    ordersTable.grant(handler, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query');

    // ── API Routes ───────────────────────────────────────────────

    const integration = new apigateway.LambdaIntegration(handler);

    const corsOptions: apigateway.CorsOptions = {
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: apigateway.Cors.ALL_METHODS,
      allowHeaders: ['Content-Type'],
    };

    const root = this.api.root.addResource('demo-exchange');

    // GET /demo-exchange/balance
    const balanceResource = root.addResource('balance');
    balanceResource.addCorsPreflight(corsOptions);
    balanceResource.addMethod('GET', integration);

    // GET /demo-exchange/pairs
    const pairsResource = root.addResource('pairs');
    pairsResource.addCorsPreflight(corsOptions);
    pairsResource.addMethod('GET', integration);

    // GET  /demo-exchange/orders  — list orders
    // POST /demo-exchange/orders  — place order
    const ordersResource = root.addResource('orders');
    ordersResource.addCorsPreflight(corsOptions);
    ordersResource.addMethod('GET', integration);
    ordersResource.addMethod('POST', integration);

    // DELETE /demo-exchange/orders/{orderId} — cancel order
    const orderIdResource = ordersResource.addResource('{orderId}');
    orderIdResource.addCorsPreflight(corsOptions);
    orderIdResource.addMethod('DELETE', integration);
  }
}
