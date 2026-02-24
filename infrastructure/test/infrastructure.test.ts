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

    const auth = new AuthStack(stack, 'Auth', { environment: 'test' });
    const restApi = new RestApiStack(stack, 'RestApi', {
      environment: 'test',
      userPool: auth.userPool,
    });

    const core = new DomainCoreStack(stack, 'Core', {
      environment: 'test',
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    template = Template.fromStack(core);
  });

  it('creates the Core Lambda function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'CoreHandler-test',
      Runtime: 'nodejs24.x',
    });
  });

  it('creates the Feedback DynamoDB table', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'Feedback-test',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    });
  });
});
