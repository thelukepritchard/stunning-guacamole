#!/opt/homebrew/opt/node/bin/node
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { AuthStack } from '../lib/auth';
import { RestApiStack } from '../lib/rest-api';
import { DomainPortfolioStack } from '../lib/domain-portfolio';
import { DomainOrderbookStack } from '../lib/domain-orderbook';
import { DomainCoreStack } from '../lib/domain-core';
import { AuthPageStack } from '../lib/auth-page';
import { WebappStack } from '../lib/webapp';
import { WebsiteStack } from '../lib/website';

const app = new cdk.App();

// Check if ENV is set
if (!process.env.ENV) {
  throw new Error("ENV environment variable is not set. Please set it to the desired environment (e.g., 'prod', 'dev').");
}

const environment = process.env.ENV

/**
 * Root stack that composes all nested stacks.
 *
 * Dependency flow:
 *   AuthStack -> RestApiStack -> Portfolio + Orderbook
 *   AuthPageStack, WebappStack, WebsiteStack (independent)
 */
class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const auth = new AuthStack(this, `AuthStack`, { environment });

    const restApi = new RestApiStack(this, `RestApiStack`, {
      environment,
      userPool: auth.userPool,
    });

    new DomainPortfolioStack(this, `DomainPortfolioStack`, {
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    new DomainOrderbookStack(this, `DomainOrderbookStack`, {
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    new DomainCoreStack(this, `DomainCoreStack`, {
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    new AuthPageStack(this, `AuthPageStack`, { environment });

    new WebappStack(this, `WebappStack`, { environment });

    new WebsiteStack(this, `WebsiteStack`, { environment });
  }
}

new InfrastructureStack(app, `InfrastructureStack-${environment === "dev" ? "dev" : "prod"}`, {
  env: {
    account: '841162675311',
    region: 'ap-southeast-2'
  }
});
