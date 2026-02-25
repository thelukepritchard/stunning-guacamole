import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainCoreStack}. */
export interface DomainCoreStackProps extends cdk.NestedStackProps {

  /** Project name prefix for resource naming. */
  name: string;

  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;

  /** The REST API to attach the /core resource to. */
  api: apigateway.RestApi;

  /** The Cognito authorizer to protect the /core endpoint. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;
}

/**
 * Core domain stack.
 *
 * Creates a DynamoDB feedback table, a Lambda function (bundled from
 * `src/domains/core/index.ts`), and wires it as a Cognito-protected
 * endpoint under `/core` on the shared REST API.
 */
export class DomainCoreStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: DomainCoreStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'core');

    const feedbackTable = new dynamodb.Table(this, 'FeedbackTable', {
      tableName: `${props.name}-${props.environment}-feedback`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const handler = new NodejsFunction(this, 'CoreHandler', {
      functionName: `${props.name}-${props.environment}-core-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/core/index.ts'),
      handler: 'handler',
      environment: {
        FEEDBACK_TABLE_NAME: feedbackTable.tableName,
      },
    });

    feedbackTable.grant(handler, 'dynamodb:PutItem');

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

    const resource = props.api.root.addResource('core');
    const feedbackResource = resource.addResource('feedback');
    feedbackResource.addCorsPreflight(corsOptions);

    // POST /core/feedback — submit user feedback
    feedbackResource.addMethod('POST', integration, methodOptions);
  }
}
