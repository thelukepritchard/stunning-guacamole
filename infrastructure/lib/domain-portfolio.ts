import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainPortfolioStack}. */
export interface DomainPortfolioStackProps extends cdk.NestedStackProps {

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
 * and wires it as a Cognito-protected proxy under `/portfolio` on the shared
 * REST API. All HTTP methods and sub-paths are forwarded to the handler.
 */
export class DomainPortfolioStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: DomainPortfolioStackProps) {
    super(scope, id, props);

    const handler = new NodejsFunction(this, 'PortfolioHandler', {
      functionName: `PortfolioHandler-${props.environment}`,
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/domains/portfolio/index.ts'),
      handler: 'handler',
    });

    const integration = new apigateway.LambdaIntegration(handler);

    const methodOptions: apigateway.MethodOptions = {
      authorizer: props.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const resource = props.api.root.addResource('portfolio');

    // ANY /portfolio — handles GET/POST on the collection
    resource.addMethod('ANY', integration, methodOptions);

    // ANY /portfolio/{id} — handles GET/PUT/DELETE on a single item
    const idResource = resource.addResource('{id}');
    idResource.addMethod('ANY', integration, methodOptions);
  }
}
