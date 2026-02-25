import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as identity from 'aws-cdk-lib/aws-cognito-identitypool';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { verificationEmailBody, verificationEmailSubject } from './verification-email-template';

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
 * Creates a User Pool with self-sign-up enabled, a User Pool Client
 * for API access, a portfolio DynamoDB table (one record per user
 * with a username-index GSI for uniqueness checks), a pre-sign-up
 * Lambda trigger that validates username format and uniqueness, and
 * a post-confirmation Lambda trigger that creates the portfolio entry
 * with the user's chosen username.
 */
export class AuthStack extends cdk.NestedStack {

  /** The Cognito User Pool used for authentication. */
  public readonly userPool: cognito.UserPool;

  /** The User Pool Client for API access. */
  public readonly userPoolClient: cognito.UserPoolClient;

  /** The portfolio DynamoDB table (one record per user, created on sign-up). */
  public readonly portfolioTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    // ─── Portfolio Table ──────────────────────────────────────────
    // Created here (alongside UserPool) to avoid circular dependencies
    // between AuthStack and DomainPortfolioStack. Handler code lives
    // in src/domains/portfolio/async/post-confirmation.ts.

    this.portfolioTable = new dynamodb.Table(this, 'PortfolioTable', {
      tableName: `${props.name}-${props.environment}-portfolio`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.portfolioTable.addGlobalSecondaryIndex({
      indexName: 'username-index',
      partitionKey: { name: 'username', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // ─── Pre-Sign-Up Lambda ────────────────────────────────────────

    const preSignUpHandler = new NodejsFunction(this, 'PreSignUpHandler', {
      functionName: `${props.name}-${props.environment}-portfolio-pre-signup`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/portfolio/async/pre-signup.ts'),
      handler: 'handler',
      environment: {
        PORTFOLIO_TABLE_NAME: this.portfolioTable.tableName,
      },
    });

    this.portfolioTable.grantReadData(preSignUpHandler);

    // ─── Post-Confirmation Lambda ─────────────────────────────────

    const postConfirmationHandler = new NodejsFunction(this, 'PostConfirmationHandler', {
      functionName: `${props.name}-${props.environment}-portfolio-post-confirmation`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/portfolio/async/post-confirmation.ts'),
      handler: 'handler',
      environment: {
        PORTFOLIO_TABLE_NAME: this.portfolioTable.tableName,
      },
    });

    this.portfolioTable.grantWriteData(postConfirmationHandler);

    // ─── Cognito User Pool ────────────────────────────────────────

    this.userPool = new cognito.UserPool(this, 'WebAppUserPool', {
      userPoolName: `${props.name}-${props.environment}-webapp-user-pool`,
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      signInAliases: { email: true },
      standardAttributes: {
        preferredUsername: { required: true, mutable: false },
      },
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
        emailSubject: verificationEmailSubject,
        emailBody: verificationEmailBody,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lambdaTriggers: {
        preSignUp: preSignUpHandler,
        postConfirmation: postConfirmationHandler,
      },
    });

    this.userPoolClient = this.userPool.addClient('UserPoolClient');

    const authenticatedRole = new iam.Role(this, 'DefaultRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': 'ap-southeast-2:319f70e9-eacf-4fff-bed7-69f7386456a1'// identityPool.identityPoolId,
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
