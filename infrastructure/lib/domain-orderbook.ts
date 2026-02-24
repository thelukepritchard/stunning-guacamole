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
}

/**
 * Orderbook domain stack.
 *
 * Creates a Lambda function (bundled from `src/domains/orderbook/index.ts`)
 * and wires it as a Cognito-protected endpoint under `/orderbook` on the shared
 * REST API with explicit GET/POST/PUT/DELETE methods.
 */
export class DomainOrderbookStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: DomainOrderbookStackProps) {
    super(scope, id, props);

    const handler = new NodejsFunction(this, 'OrderbookHandler', {
      functionName: `${props.name}-${props.environment}-orderbook-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/domains/orderbook/index.ts'),
      handler: 'handler',
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

    // GET /orderbook — list orders
    resource.addMethod('GET', integration, methodOptions);
    // POST /orderbook — place order
    resource.addMethod('POST', integration, methodOptions);

    // /orderbook/{id}
    const idResource = resource.addResource('{id}');
    idResource.addCorsPreflight(corsOptions);
    // GET /orderbook/{id} — get single order
    idResource.addMethod('GET', integration, methodOptions);
    // PUT /orderbook/{id} — update order
    idResource.addMethod('PUT', integration, methodOptions);
    // DELETE /orderbook/{id} — cancel order
    idResource.addMethod('DELETE', integration, methodOptions);
  }
}
