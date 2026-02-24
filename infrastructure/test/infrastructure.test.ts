import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth';
import { RestApiStack } from '../lib/rest-api';
import { DomainCoreStack } from '../lib/domain-core';
import { DomainTradingStack } from '../lib/domain-trading';

describe('DomainCoreStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    const auth = new AuthStack(stack, 'Auth', { name: 'techniverse', environment: 'test' });
    const restApi = new RestApiStack(stack, 'RestApi', {
      name: 'techniverse',
      environment: 'test',
      userPool: auth.userPool,
    });

    const core = new DomainCoreStack(stack, 'Core', {
      name: 'techniverse',
      environment: 'test',
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    template = Template.fromStack(core);
  });

  it('creates the Core Lambda function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'techniverse-test-core-handler',
      Runtime: 'nodejs24.x',
    });
  });

  it('creates the Feedback DynamoDB table', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'techniverse-test-feedback',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    });
  });
});

describe('DomainTradingStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    const auth = new AuthStack(stack, 'Auth', { name: 'techniverse', environment: 'test' });
    const restApi = new RestApiStack(stack, 'RestApi', {
      name: 'techniverse',
      environment: 'test',
      userPool: auth.userPool,
    });

    const trading = new DomainTradingStack(stack, 'Trading', {
      name: 'techniverse',
      environment: 'test',
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    template = Template.fromStack(trading);
  });

  /** Asserts the Trading handler Lambda function is created with the correct name and runtime. */
  it('creates the Trading handler Lambda function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'techniverse-test-trading-handler',
      Runtime: 'nodejs24.x',
    });
  });

  /** Asserts the Trading price publisher Lambda function is created with the correct name and runtime. */
  it('creates the Trading price publisher Lambda function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'techniverse-test-trading-price-publisher',
      Runtime: 'nodejs24.x',
    });
  });

  /** Asserts the Trading bot executor Lambda function is created with the correct name and runtime. */
  it('creates the Trading bot executor Lambda function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'techniverse-test-trading-bot-executor',
      Runtime: 'nodejs24.x',
    });
  });

  /** Asserts the Trading bot stream Lambda function is created with the correct name and runtime. */
  it('creates the Trading bot stream Lambda function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'techniverse-test-trading-bot-stream',
      Runtime: 'nodejs24.x',
    });
  });

  /** Asserts the Trading Bots DynamoDB table is created with the correct name and key schema. */
  it('creates the Trading Bots DynamoDB table', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'techniverse-test-trading-bots',
      KeySchema: [
        { AttributeName: 'sub', KeyType: 'HASH' },
        { AttributeName: 'botId', KeyType: 'RANGE' },
      ],
    });
  });

  /** Asserts the Trading Trades DynamoDB table is created with the correct name and key schema. */
  it('creates the Trading Trades DynamoDB table', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'techniverse-test-trading-trades',
      KeySchema: [
        { AttributeName: 'botId', KeyType: 'HASH' },
        { AttributeName: 'timestamp', KeyType: 'RANGE' },
      ],
    });
  });

  /** Asserts the Trading Indicators SNS topic is created with the correct name. */
  it('creates the Trading Indicators SNS topic', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'techniverse-test-trading-indicators',
    });
  });

  /** Asserts an EventBridge rule is created for the Trading domain. */
  it('creates an EventBridge rule', () => {
    template.hasResourceProperties('AWS::Events::Rule', {});
  });
});
