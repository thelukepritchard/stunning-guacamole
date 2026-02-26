import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

/** Props for {@link DomainBacktestingStack}. */
export interface DomainBacktestingStackProps extends cdk.NestedStackProps {
  /** Project name prefix for resource naming. */
  name: string;
  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;
  /** The REST API to attach routes to. */
  api: apigateway.RestApi;
  /** The Cognito authorizer to protect endpoints. */
  authorizer: apigateway.CognitoUserPoolsAuthorizer;
  /** The bots DynamoDB table (for validating bot ownership). */
  botsTable: dynamodb.Table;
  /** The price history DynamoDB table (for backtest replay). */
  priceHistoryTable: dynamodb.Table;
}

/**
 * Backtesting domain stack.
 *
 * Owns the backtest workflow — validates, runs, and stores backtest
 * results. Creates the backtests metadata DynamoDB table, an S3 bucket
 * for report storage, an AWS Step Functions workflow (validate -> wait ->
 * engine -> write-report), an API handler Lambda, and Cognito-protected
 * API routes under `/backtests`.
 */
export class DomainBacktestingStack extends cdk.NestedStack {

  /** The backtests metadata DynamoDB table (exposed for cross-domain references). */
  public readonly backtestsTable: dynamodb.Table;

  /** The S3 bucket for backtest report JSON objects (exposed for cross-domain references). */
  public readonly backtestReportsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DomainBacktestingStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Domain', 'backtesting');

    // ─── DynamoDB Tables ──────────────────────────────────────────

    this.backtestsTable = new dynamodb.Table(this, 'BacktestsTable', {
      tableName: `${props.name}-${props.environment}-backtesting-backtests`,
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'backtestId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.backtestsTable.addGlobalSecondaryIndex({
      indexName: 'botId-index',
      partitionKey: { name: 'botId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'testedAt', type: dynamodb.AttributeType.STRING },
    });

    // ─── S3 Bucket ────────────────────────────────────────────────

    this.backtestReportsBucket = new s3.Bucket(this, 'BacktestReportsBucket', {
      bucketName: `${props.name}-${props.environment}-backtesting-reports`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ─── Lambda Functions ─────────────────────────────────────────

    // Backtesting API handler — serves backtest queries and submissions
    const handler = new NodejsFunction(this, 'BacktestingApiHandler', {
      functionName: `${props.name}-${props.environment}-backtesting-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/backtesting/index.ts'),
      handler: 'handler',
      environment: {
        BOTS_TABLE_NAME: props.botsTable.tableName,
        BACKTESTS_TABLE_NAME: this.backtestsTable.tableName,
        BACKTEST_REPORTS_BUCKET: this.backtestReportsBucket.bucketName,
        PRICE_HISTORY_TABLE_NAME: props.priceHistoryTable.tableName,
      },
    });

    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem',
      ],
      resources: [
        props.botsTable.tableArn, `${props.botsTable.tableArn}/index/*`,
        this.backtestsTable.tableArn, `${this.backtestsTable.tableArn}/index/*`,
        props.priceHistoryTable.tableArn,
      ],
    }));

    this.backtestReportsBucket.grantRead(handler);

    // Step 1: Validate and snapshot
    const backtestValidateHandler = new NodejsFunction(this, 'BacktestValidateHandler', {
      functionName: `${props.name}-${props.environment}-backtesting-validate`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/backtesting/async/backtest-validate.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        BOTS_TABLE_NAME: props.botsTable.tableName,
        BACKTESTS_TABLE_NAME: this.backtestsTable.tableName,
      },
    });

    props.botsTable.grantReadData(backtestValidateHandler);
    this.backtestsTable.grant(backtestValidateHandler, 'dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:UpdateItem');

    // Step 3: Run backtest engine
    const backtestEngineHandler = new NodejsFunction(this, 'BacktestEngineHandler', {
      functionName: `${props.name}-${props.environment}-backtesting-engine`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/backtesting/async/backtest-engine.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(300),
      environment: {
        PRICE_HISTORY_TABLE_NAME: props.priceHistoryTable.tableName,
      },
    });

    props.priceHistoryTable.grantReadData(backtestEngineHandler);

    // Step 4: Write report
    const backtestWriteReportHandler = new NodejsFunction(this, 'BacktestWriteReportHandler', {
      functionName: `${props.name}-${props.environment}-backtesting-write-report`,
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 256,
      entry: path.join(__dirname, '../../src/domains/backtesting/async/backtest-write-report.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        BACKTESTS_TABLE_NAME: this.backtestsTable.tableName,
        BACKTEST_REPORTS_BUCKET: this.backtestReportsBucket.bucketName,
      },
    });

    this.backtestsTable.grant(backtestWriteReportHandler,
      'dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem');
    this.backtestReportsBucket.grantReadWrite(backtestWriteReportHandler);
    this.backtestReportsBucket.grantDelete(backtestWriteReportHandler);

    // Grant write-report handler permission to publish EventBridge events
    backtestWriteReportHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
    }));

    // ─── Step Functions Workflow ───────────────────────────────────

    const validateStep = new tasks.LambdaInvoke(this, 'ValidateAndSnapshot', {
      lambdaFunction: backtestValidateHandler,
      outputPath: '$.Payload',
    });

    const waitStep = new sfn.Wait(this, 'ArtificialDelay', {
      time: sfn.WaitTime.secondsPath('$.waitSeconds'),
    });

    const engineStep = new tasks.LambdaInvoke(this, 'RunBacktest', {
      lambdaFunction: backtestEngineHandler,
      outputPath: '$.Payload',
    });

    const writeReportStep = new tasks.LambdaInvoke(this, 'WriteReport', {
      lambdaFunction: backtestWriteReportHandler,
      outputPath: '$.Payload',
    });

    const failStep = new tasks.LambdaInvoke(this, 'HandleFailure', {
      lambdaFunction: backtestWriteReportHandler,
      payload: sfn.TaskInput.fromObject({
        failed: true,
        'error.$': '$.Error',
        'cause.$': '$.Cause',
        'backtestId.$': '$$.Execution.Input.backtestId',
        'sub.$': '$$.Execution.Input.sub',
      }),
      outputPath: '$.Payload',
    });

    const definition = validateStep
      .addCatch(failStep, { resultPath: '$.errorInfo' })
      .next(waitStep)
      .next(
        engineStep.addCatch(failStep, { resultPath: '$.errorInfo' }),
      )
      .next(
        writeReportStep.addCatch(failStep, { resultPath: '$.errorInfo' }),
      );

    const backtestWorkflow = new sfn.StateMachine(this, 'BacktestWorkflow', {
      stateMachineName: `${props.name}-${props.environment}-backtesting-workflow`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(15),
    });

    // Grant API handler permission to start Step Functions executions
    backtestWorkflow.grantStartExecution(handler);
    handler.addEnvironment('BACKTEST_WORKFLOW_ARN', backtestWorkflow.stateMachineArn);

    // ─── API Gateway Routes ───────────────────────────────────────

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

    // /backtests/{botId}
    const backtestsResource = props.api.root.addResource('backtests');
    const backtestBotIdResource = backtestsResource.addResource('{botId}');
    backtestBotIdResource.addCorsPreflight(corsOptions);
    backtestBotIdResource.addMethod('POST', integration, methodOptions);
    backtestBotIdResource.addMethod('GET', integration, methodOptions);

    // /backtests/{botId}/latest
    const latestResource = backtestBotIdResource.addResource('latest');
    latestResource.addCorsPreflight(corsOptions);
    latestResource.addMethod('GET', integration, methodOptions);

    // /backtests/{botId}/{backtestId}
    const backtestIdResource = backtestBotIdResource.addResource('{backtestId}');
    backtestIdResource.addCorsPreflight(corsOptions);
    backtestIdResource.addMethod('GET', integration, methodOptions);
  }
}
