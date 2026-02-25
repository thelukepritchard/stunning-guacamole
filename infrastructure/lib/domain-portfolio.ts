import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainPortfolioStack}. */
export interface DomainPortfolioStackProps extends cdk.NestedStackProps {

  /** Project name prefix for resource naming. */
  name: string;

  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;

  /** The REST API to attach the /portfolio resource to. */
  api: apigateway.RestApi;

  /** The Cognito authorizer to protect the /portfolio endpoint. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;
}

/**
 * Portfolio domain stack.
 *
 * Creates a Lambda function (bundled from `src/domains/portfolio/index.ts`)
 * and wires it as a Cognito-protected endpoint under `/portfolio` on the shared
 * REST API with explicit GET/POST/PUT/DELETE methods.
 */
export class DomainPortfolioStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: DomainPortfolioStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'portfolio');

    const handler = new NodejsFunction(this, 'PortfolioHandler', {
      functionName: `${props.name}-${props.environment}-portfolio-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/domains/portfolio/index.ts'),
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

    const resource = props.api.root.addResource('portfolio');
    resource.addCorsPreflight(corsOptions);

    // GET /portfolio — list portfolios
    resource.addMethod('GET', integration, methodOptions);
    // POST /portfolio — create portfolio
    resource.addMethod('POST', integration, methodOptions);

    // /portfolio/{id}
    const idResource = resource.addResource('{id}');
    idResource.addCorsPreflight(corsOptions);
    // GET /portfolio/{id} — get single portfolio
    idResource.addMethod('GET', integration, methodOptions);
    // PUT /portfolio/{id} — update portfolio
    idResource.addMethod('PUT', integration, methodOptions);
    // DELETE /portfolio/{id} — delete portfolio
    idResource.addMethod('DELETE', integration, methodOptions);
  }
}
