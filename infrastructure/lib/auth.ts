import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as identity from 'aws-cdk-lib/aws-cognito-identitypool';
import { Construct } from 'constructs';

/** Props for {@link AuthStack}. */
export interface AuthStackProps extends cdk.NestedStackProps {

  /** Project name prefix for resource naming. */
  name: string;

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
      userPoolName: `${props.name}-${props.environment}-user-pool`,
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      signInAliases: { email: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('UserPoolClient');

    const authenticatedRole = new iam.Role(this, 'DefaultRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': 'ap-southeast-2:25823bd1-4771-490a-9e54-3968b4535fed'// identityPool.identityPoolId,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    const identityPool = new identity.IdentityPool(this, 'myidentitypool', {
      identityPoolName: `${props.name}-${props.environment}-identity-pool`,
      authenticatedRole: authenticatedRole,
    });

    identityPool.addUserPoolAuthentication(new identity.UserPoolAuthenticationProvider({
      userPool: this.userPool,
      userPoolClient: this.userPoolClient,
    }));
  }
}
