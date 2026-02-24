# Infrastructure

AWS CDK v2 project that provisions the backend for the stunning-guacomole SaaS platform.

## Stack Architecture

A single root `InfrastructureStack` composed of nested stacks:

```
AuthStack (Cognito User Pool + Client)
    |
RestApiStack (API Gateway REST API + Cognito Authorizer)
    |           |          |
Portfolio    Orderbook    Core

AuthPageStack  (S3 + CloudFront — auth page SPA)
WebappStack    (S3 + CloudFront — authenticated dashboard)
WebsiteStack   (S3 + CloudFront — public marketing site)
```

- **AuthStack** (`lib/auth.ts`) — Cognito User Pool (self-sign-up enabled, email auto-verified) and User Pool Client.
- **RestApiStack** (`lib/rest-api.ts`) — API Gateway REST API with a Cognito User Pools authorizer.
- **DomainPortfolioStack** (`lib/domain-portfolio.ts`) — `NodejsFunction` bundled from `src/domains/portfolio/index.ts`, integrated at `ANY /portfolio` and `ANY /portfolio/{id}`, Cognito-protected.
- **DomainOrderbookStack** (`lib/domain-orderbook.ts`) — `NodejsFunction` bundled from `src/domains/orderbook/index.ts`, integrated at `ANY /orderbook` and `ANY /orderbook/{id}`, Cognito-protected.
- **DomainCoreStack** (`lib/domain-core.ts`) — DynamoDB `Feedback` table + `NodejsFunction` bundled from `src/domains/core/index.ts`, integrated at `POST /core/feedback`, Cognito-protected.
- **AuthPageStack** (`lib/auth-page.ts`) — S3 bucket + CloudFront distribution serving the authentication SPA.
- **WebappStack** (`lib/webapp.ts`) — S3 bucket + CloudFront distribution serving the authenticated dashboard.
- **WebsiteStack** (`lib/website.ts`) — S3 bucket + CloudFront distribution serving the public marketing site.

All resources are suffixed with the environment name (e.g. `UserPool-dev`) to support parallel deployments.

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
2. Accept `api` and `authorizer` via props; add `ANY` methods on the root resource and any sub-resources (e.g. `{id}`).
3. Wire the new stack in `bin/infrastructure.ts`, passing the REST API and authorizer.
4. Add a test in `test/infrastructure.test.ts` asserting the Lambda is created.

## Adding a New Frontend Stack

1. Create `lib/<name>.ts` as a `cdk.NestedStack` with props containing `environment: string`.
2. Create a private S3 bucket (`BLOCK_ALL`, `DESTROY` removal policy, `autoDeleteObjects: true`), named `<name>-${env}`.
3. Create a CloudFront distribution using `S3BucketOrigin.withOriginAccessControl()` (CDK auto-creates the OAC and bucket policy). Set `defaultRootObject: 'index.html'`, HTTPS redirect, and SPA error responses (403 + 404 → `/index.html` with 200).
4. Expose `bucket` and `distribution` as public readonly properties.
5. Wire the new stack in `bin/infrastructure.ts` passing the environment.
6. Add JSDoc on all classes, interfaces, properties, and constructors.
