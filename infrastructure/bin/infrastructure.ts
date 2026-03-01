#!/opt/homebrew/opt/node/bin/node
import * as cdk from 'aws-cdk-lib/core';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { AuthStack } from '../lib/auth';
import { RestApiStack } from '../lib/rest-api';
import { DomainBotsStack } from '../lib/domain-bots';
import { DomainMarketStack } from '../lib/domain-market';
import { DomainExecutorStack } from '../lib/domain-executor';
import { DomainExchangeStack } from '../lib/domain-exchange';
import { DomainAnalyticsStack } from '../lib/domain-analytics';
import { DomainBacktestingStack } from '../lib/domain-backtesting';
import { DomainAccountStack } from '../lib/domain-account';
import { WebappStack } from '../lib/webapp';
import { WebsiteStack } from '../lib/website';

const app = new cdk.App();

// Check if ENV is set
if (!process.env.ENV) {
  throw new Error("ENV environment variable is not set. Please set it to the desired environment (e.g., 'prod', 'dev').");
}

const name = "signalr";
const environment = process.env.ENV

/** CloudFront ACM certificate ARN (must be in us-east-1). */
const cloudfrontCertificateArn = 'arn:aws:acm:us-east-1:090517336066:certificate/26ea605c-d85f-4601-80be-e808f98a0a92';

/** Regional ACM certificate ARN (must be in ap-southeast-2, same region as the stack). */
const regionalCertificateArn = 'arn:aws:acm:ap-southeast-2:090517336066:certificate/c1f4f58b-049f-49b5-9521-e4215c38c8fa';

/**
 * Root stack that composes all nested stacks.
 *
 * Dependency flow:
 *   AuthStack -> RestApiStack -> Exchange, Bots -> Market -> Executor
 *   -> Backtesting (needs bots + price history) -> Analytics (needs bots + trades + price history)
 *   -> Account (references all tables by name)
 *   WebappStack, WebsiteStack (independent)
 */
class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DNS — look up hosted zone and import certificates
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: `techniverse.com.au`,
    });

    const cloudfrontCertificate = acm.Certificate.fromCertificateArn(
      this, 'CloudFrontCertificate', cloudfrontCertificateArn,
    );

    const regionalCertificate = acm.Certificate.fromCertificateArn(
      this, 'RegionalCertificate', regionalCertificateArn,
    );

    // Compute domain names based on environment
    const webappDomainName = environment === 'prod'
      ? `trade.techniverse.com.au`
      : `trade-${environment}.${name}.com.au`;

    const websiteDomainName = environment === 'prod'
      ? `techniverse.com.au`
      : `site-${environment}.${name}.com.au`;

    const apiDomainName = environment === 'prod'
      ? `api.techniverse.com.au`
      : `api-${environment}.${name}.com.au`;

    const auth = new AuthStack(this, `AuthStack`, { name, environment });

    const restApi = new RestApiStack(this, `RestApiStack`, {
      name,
      environment,
      userPool: auth.userPool,
      domainName: apiDomainName,
      certificate: cloudfrontCertificate,
      hostedZone,
    });

    // ─── Domain Stacks ─────────────────────────────────────────────

    // Exchange must be created first (exchange proxy needs demo exchange URL)
    const exchange = new DomainExchangeStack(this, `DomainExchangeStack`, {
      name,
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    // Bots — bot CRUD + settings
    const bots = new DomainBotsStack(this, `DomainBotsStack`, {
      name,
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    // Market — price ingestion + SNS distribution
    const market = new DomainMarketStack(this, `DomainMarketStack`, {
      name,
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
    });

    // Executor — rule evaluation + trades (depends on bots table + market SNS topic + exchange connections)
    const executor = new DomainExecutorStack(this, `DomainExecutorStack`, {
      name,
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
      botsTable: bots.botsTable,
      indicatorsTopic: market.indicatorsTopic,
      demoExchangeApiUrl: exchange.demoExchangeApi.url,
      demoExchangeApi: exchange.demoExchangeApi,
      connectionsTable: exchange.connectionsTable,
      credentialsKey: exchange.credentialsKey,
    });

    // Backtesting — backtest workflow (depends on bots table + price history table)
    new DomainBacktestingStack(this, `DomainBacktestingStack`, {
      name,
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
      botsTable: bots.botsTable,
      priceHistoryTable: market.priceHistoryTable,
    });

    // Analytics — performance tracking + leaderboard (depends on bots, trades, price history, portfolio)
    new DomainAnalyticsStack(this, `DomainAnalyticsStack`, {
      name,
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
      portfolioTable: auth.portfolioTable,
      botsTable: bots.botsTable,
      tradesTable: executor.tradesTable,
      priceHistoryTable: market.priceHistoryTable,
    });

    // Account — feedback + account deletion (references all tables by name)
    new DomainAccountStack(this, `DomainAccountStack`, {
      name,
      environment,
      api: restApi.api,
      authorizer: restApi.authorizer,
      userPool: auth.userPool,
    });

    // ─── Frontend Stacks ───────────────────────────────────────────

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

new InfrastructureStack(app, `${name}-${environment}`, {
  env: {
    account: '090517336066',
    region: 'ap-southeast-2'
  }
});
