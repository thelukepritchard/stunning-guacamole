import * as cdk from 'aws-cdk-lib/core';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/** Props for {@link RestApiStack}. */
export interface RestApiStackProps extends cdk.NestedStackProps {

  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;

  /** Cognito User Pool to back the API authorizer. */
  userPool: cognito.IUserPool;
}

/**
 * REST API Gateway stack with Cognito authorization.
 *
 * Creates an API Gateway REST API and a Cognito User Pools authorizer
 * that domain stacks can attach resources to.
 */
export class RestApiStack extends cdk.NestedStack {

  /** The API Gateway REST API. */
  public readonly api: apigateway.RestApi;

  /** The Cognito authorizer for protecting API methods. */
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: RestApiStackProps) {
    super(scope, id, props);

    this.api = new apigateway.RestApi(this, 'RestApi', {
      restApiName: `RestApi-${props.environment}`,
    });

    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      authorizerName: `CognitoAuthorizer-${props.environment}`,
      cognitoUserPools: [props.userPool],
    });
  }
}
