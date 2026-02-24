import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth';
import { RestApiStack } from '../lib/rest-api';
import { DomainCoreStack } from '../lib/domain-core';

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
