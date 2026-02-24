import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/** Props for {@link AuthStack}. */
export interface AuthStackProps extends cdk.NestedStackProps {

  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;
}

/**
 * Cognito authentication stack.
 *
 * Creates a User Pool with self-sign-up enabled and a User Pool Client
 * for API access.
 */
export class AuthStack extends cdk.NestedStack {

  /** The Cognito User Pool used for authentication. */
  public readonly userPool: cognito.UserPool;

  /** The User Pool Client for API access. */
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `UserPool-${props.environment}`,
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      signInAliases: { email: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('UserPoolClient');
  }
}
