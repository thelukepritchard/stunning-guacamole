# Infrastructure

AWS CDK v2 project that provisions the backend for the stunning-guacomole SaaS platform.

## Stack Architecture

A single root `InfrastructureStack` composed of nested stacks:

```
AuthStack (Cognito User Pool + Client)
    |
RestApiStack (API Gateway REST API + Cognito Authorizer)
    |           |          |         |
Portfolio    Orderbook    Core    Trading

AuthPageStack  (S3 + CloudFront — auth page SPA)
WebappStack    (S3 + CloudFront — authenticated dashboard)
WebsiteStack   (S3 + CloudFront — public marketing site)
```

- **AuthStack** (`lib/auth.ts`) — Cognito User Pool (self-sign-up enabled, email auto-verified) and User Pool Client.
- **RestApiStack** (`lib/rest-api.ts`) — API Gateway REST API (REGIONAL endpoint) with a Cognito User Pools authorizer and custom domain.
- **DomainPortfolioStack** (`lib/domain-portfolio.ts`) — `NodejsFunction` bundled from `src/domains/portfolio/index.ts`, integrated at `ANY /portfolio` and `ANY /portfolio/{id}`, Cognito-protected.
- **DomainOrderbookStack** (`lib/domain-orderbook.ts`) — `NodejsFunction` bundled from `src/domains/orderbook/index.ts`, integrated at `ANY /orderbook` and `ANY /orderbook/{id}`, Cognito-protected.
- **DomainCoreStack** (`lib/domain-core.ts`) — DynamoDB `Feedback` table + `NodejsFunction` bundled from `src/domains/core/index.ts`, integrated at `POST /core/feedback`, Cognito-protected.
- **DomainTradingStack** (`lib/domain-trading.ts`) — DynamoDB `Bots` + `Trades` tables, SNS `Indicators` topic, 4 Lambda functions (API handler, price publisher, bot executor, lifecycle handler), EventBridge 1-min price schedule + bot lifecycle event routing (`signalr.trading` source), API handler granted `events:PutEvents`, integrated at `/trading/bots`, `/trading/bots/{botId}`, `/trading/trades`, `/trading/trades/{botId}`, Cognito-protected.
- **AuthPageStack** (`lib/auth-page.ts`) — S3 bucket + CloudFront distribution serving the authentication SPA.
- **WebappStack** (`lib/webapp.ts`) — S3 bucket + CloudFront distribution serving the authenticated dashboard, with custom domain and Route53 alias.
- **WebsiteStack** (`lib/website.ts`) — S3 bucket + CloudFront distribution serving the public marketing site, with custom domain and Route53 alias.

All resources follow the naming convention `${name}-${environment}-${description}` (e.g. `techniverse-dev-user-pool`). The `name` (`"techniverse"`) is defined in `bin/infrastructure.ts` and passed to all nested stacks via props.

All domain stacks apply a `Domain` tag (e.g. `Domain: trading`) to all their resources via `cdk.Tags.of(this).add('Domain', '<domain-name>')` at the top of the constructor. This enables filtering and cost attribution by domain in AWS.

## DNS & Custom Domains

Route53 hosted zone `${name}.com.au` is looked up at synth time. Two pre-provisioned ACM certificates are imported by ARN in `bin/infrastructure.ts`:

- **CloudFront certificate** — must be in **us-east-1** (CloudFront requirement). Covers `${name}.com.au` and `*.${name}.com.au`.
- **Regional certificate** — must be in **ap-southeast-2** (same region as the stack). Used for the API Gateway custom domain.

Domain names are environment-dependent:

| Resource | prod | non-prod (e.g. dev) |
|----------|------|---------------------|
| Webapp   | `trade.${name}.com.au` | `trade-${env}.${name}.com.au` |
| Website  | `${name}.com.au` | `site-${env}.${name}.com.au` |
| REST API | `api.${name}.com.au` | `api-${env}.${name}.com.au` |

Each stack (WebappStack, WebsiteStack, RestApiStack) creates its own Route53 A record (alias) pointing to its CloudFront distribution or API Gateway regional domain. DNS props are optional on all stacks to allow tests to run without a hosted zone.

## Commands

The `ENV` environment variable is required for all CDK commands.

```bash
# Build TypeScript
npm run build

# Run tests
npm test

# Synth CloudFormation template
ENV=dev npx cdk synth

# Deploy to dev
ENV=dev npx cdk deploy

# Deploy to prod
ENV=prod npx cdk deploy

# Diff against deployed stack
ENV=dev npx cdk diff
```

## Adding a New Domain Stack

1. Create `lib/domain-<name>.ts` using `NodejsFunction` pointing to the handler entry file.
2. Accept `name`, `api`, and `authorizer` via props; add `ANY` methods on the root resource and any sub-resources (e.g. `{id}`).
3. Add `cdk.Tags.of(this).add('Domain', '<name>')` at the top of the constructor to tag all resources with their domain.
4. Name resources using `${props.name}-${props.environment}-${description}` (e.g. `${props.name}-${props.environment}-<name>-handler`).
5. Wire the new stack in `bin/infrastructure.ts`, passing `name`, the REST API, and authorizer.
6. Add a test in `test/infrastructure.test.ts` asserting the Lambda is created.

## Adding a New Frontend Stack

1. Create `lib/<name>.ts` as a `cdk.NestedStack` with props containing `name: string` and `environment: string`.
2. Create a private S3 bucket (`BLOCK_ALL`, `DESTROY` removal policy, `autoDeleteObjects: true`), named `${props.name}-${props.environment}-<name>`.
3. Create a CloudFront distribution using `S3BucketOrigin.withOriginAccessControl()` (CDK auto-creates the OAC and bucket policy). Set `defaultRootObject: 'index.html'`, HTTPS redirect, and SPA error responses (403 + 404 → `/index.html` with 200).
4. Expose `bucket` and `distribution` as public readonly properties.
5. Wire the new stack in `bin/infrastructure.ts` passing `name` and environment.
6. Add JSDoc on all classes, interfaces, properties, and constructors.
