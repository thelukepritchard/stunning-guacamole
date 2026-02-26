import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainOrderbookStack}. */
export interface DomainOrderbookStackProps extends cdk.NestedStackProps {

  /** Project name prefix for resource naming. */
  name: string;

  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;

  /** The REST API to attach the /orderbook resource to. */
  api: apigateway.RestApi;

  /** The Cognito authorizer to protect the /orderbook endpoint. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;

  /** The demo exchange REST API — used to build the proxy URL for demo-mode users. */
  demoExchangeApi: apigateway.RestApi;
}

/**
 * Orderbook domain stack.
 *
 * Acts as the exchange proxy layer. All exchange interaction from the
 * frontend and other domains is routed through the Orderbook, which
 * resolves the user's configured exchange, translates the request, and
 * returns normalised data.
 *
 * For now, all users are routed to the demo exchange.
 */
export class DomainOrderbookStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: DomainOrderbookStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'orderbook');

    const handler = new NodejsFunction(this, 'OrderbookHandler', {
      functionName: `${props.name}-${props.environment}-orderbook-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      entry: path.join(__dirname, '../../src/domains/orderbook/index.ts'),
      handler: 'handler',
      environment: {
        DEMO_EXCHANGE_API_URL: props.demoExchangeApi.url,
      },
    });

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

    const resource = props.api.root.addResource('orderbook');
    resource.addCorsPreflight(corsOptions);

    // GET /orderbook/balance — user's exchange balance
    const balanceResource = resource.addResource('balance');
    balanceResource.addCorsPreflight(corsOptions);
    balanceResource.addMethod('GET', integration, methodOptions);

    // GET /orderbook/pairs — available trading pairs
    const pairsResource = resource.addResource('pairs');
    pairsResource.addCorsPreflight(corsOptions);
    pairsResource.addMethod('GET', integration, methodOptions);

    // GET /orderbook/orders — open orders
    const ordersResource = resource.addResource('orders');
    ordersResource.addCorsPreflight(corsOptions);
    ordersResource.addMethod('GET', integration, methodOptions);

    // DELETE /orderbook/orders/{orderId} — cancel an order
    const orderIdResource = ordersResource.addResource('{orderId}');
    orderIdResource.addCorsPreflight(corsOptions);
    orderIdResource.addMethod('DELETE', integration, methodOptions);
  }
}
