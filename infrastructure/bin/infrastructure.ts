#!/opt/homebrew/opt/node/bin/node
import * as cdk from 'aws-cdk-lib/core';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { AuthStack } from '../lib/auth';
import { RestApiStack } from '../lib/rest-api';
import { DomainPortfolioStack } from '../lib/domain-portfolio';
import { DomainOrderbookStack } from '../lib/domain-orderbook';
import { DomainCoreStack } from '../lib/domain-core';
import { WebappStack } from '../lib/webapp';
import { WebsiteStack } from '../lib/website';

const app = new cdk.App();

// Check if ENV is set
if (!process.env.ENV) {
  throw new Error("ENV environment variable is not set. Please set it to the desired environment (e.g., 'prod', 'dev').");
}

const name = "techniverse"
const environment = process.env.ENV

/** CloudFront ACM certificate ARN (must be in us-east-1). */
const cloudfrontCertificateArn = 'arn:aws:acm:us-east-1:090517336066:certificate/26ea605c-d85f-4601-80be-e808f98a0a92';

/** Regional ACM certificate ARN (must be in ap-southeast-2, same region as the stack). */
const regionalCertificateArn = 'arn:aws:acm:ap-southeast-2:090517336066:certificate/c1f4f58b-049f-49b5-9521-e4215c38c8fa';

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

    // DNS — look up hosted zone and import certificates
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: `${name}.com.au`,
    });

    const cloudfrontCertificate = acm.Certificate.fromCertificateArn(
      this, 'CloudFrontCertificate', cloudfrontCertificateArn,
    );

    const regionalCertificate = acm.Certificate.fromCertificateArn(
      this, 'RegionalCertificate', regionalCertificateArn,
    );

    // Compute domain names based on environment
    const webappDomainName = environment === 'prod'
      ? `trade.${name}.com.au`
      : `trade-${environment}.${name}.com.au`;

    const websiteDomainName = environment === 'prod'
      ? `${name}.com.au`
      : `site-${environment}.${name}.com.au`;

    const apiDomainName = environment === 'prod'
      ? `api.${name}.com.au`
      : `api-${environment}.${name}.com.au`;

    const auth = new AuthStack(this, `AuthStack`, { name, environment });

    const restApi = new RestApiStack(this, `RestApiStack`, {
      name,
      environment,
      userPool: auth.userPool,
      domainName: apiDomainName,
      certificate: regionalCertificate,
      hostedZone,
    });

    new DomainPortfolioStack(this, `DomainPortfolioStack`, {
      name,
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    new DomainOrderbookStack(this, `DomainOrderbookStack`, {
      name,
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    new DomainCoreStack(this, `DomainCoreStack`, {
      name,
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    new WebappStack(this, `WebappStack`, {
      name,
      environment,
      domainName: webappDomainName,
      certificate: cloudfrontCertificate,
      hostedZone,
    });

    new WebsiteStack(this, `WebsiteStack`, {
      name,
      environment,
      domainName: websiteDomainName,
      certificate: cloudfrontCertificate,
      hostedZone,
    });
  }
}

new InfrastructureStack(app, `Tradeblocks-${environment === "dev" ? "dev" : "prod"}`, {
  env: {
    account: '090517336066',
    region: 'ap-southeast-2'
  }
});
