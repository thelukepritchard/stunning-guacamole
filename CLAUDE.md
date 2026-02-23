# stunning-guacomole

SaaS platform with a serverless backend on AWS and multiple frontend applications.

## Project Structure

```
src/
├── auth-page/            # Single-page app for authentication flows
├── webapp/               # Next.js 15 authenticated dashboard (Cognito-gated)
├── website/              # Next.js 15 public marketing site
└── domains/              # Backend domain logic (Lambda handlers)
    ├── portfolio/        # Portfolio domain — CRUD via API Gateway
    │   ├── index.ts      # Lambda entry point + route dispatch
    │   ├── utils.ts      # jsonResponse helper & RouteHandler type
    │   └── routes/       # One file per route handler
    └── orderbook/        # Orderbook domain — CRUD via API Gateway
        ├── index.ts
        ├── utils.ts
        └── routes/

infrastructure/           # AWS CDK v2 project (separate package)
├── bin/infrastructure.ts # CDK app entry point
└── lib/
    ├── auth.ts           # Cognito User Pool + Client (AuthStack)
    ├── rest-api.ts       # API Gateway REST API + Cognito Authorizer (RestApiStack)
    ├── domain-portfolio.ts   # Portfolio Lambda + API routes (DomainPortfolioStack)
    ├── domain-orderbook.ts   # Orderbook Lambda + API routes (DomainOrderbookStack)
    ├── auth-page.ts      # S3 + CloudFront for auth page SPA (AuthPageStack)
    ├── webapp.ts         # S3 + CloudFront for authenticated dashboard (WebappStack)
    └── website.ts        # S3 + CloudFront for public marketing site (WebsiteStack)
```

## Stack Architecture

```
InfrastructureStack (root, nested stacks)
├── AuthStack          — Cognito User Pool (self-sign-up disabled) + Client
├── RestApiStack       — REST API Gateway + Cognito Authorizer
├── DomainPortfolioStack — Lambda: ANY /portfolio, ANY /portfolio/{id}
├── DomainOrderbookStack — Lambda: ANY /orderbook, ANY /orderbook/{id}
├── AuthPageStack      — S3 + CloudFront (auth page SPA)
├── WebappStack        — S3 + CloudFront (authenticated dashboard)
└── WebsiteStack       — S3 + CloudFront (public marketing site)
```

All resources are suffixed with the environment name (e.g. `UserPool-dev`).

## Tech Stack

- **Runtime:** Node.js 24, TypeScript 5.9
- **Infrastructure:** AWS CDK v2 (`aws-cdk-lib@2.234.1`)
- **Auth:** AWS Cognito User Pools
- **API:** API Gateway REST API with Cognito authorizer
- **Compute:** Lambda (bundled via `NodejsFunction` / esbuild)
- **Region:** ap-southeast-2

## Domain Handler Pattern

Each domain under `src/domains/<name>/` follows this convention:

1. **`index.ts`** — Lambda entry point. Builds a route key from `event.httpMethod` + `event.resource` and dispatches via a `switch` statement.
2. **`utils.ts`** — Exports `RouteHandler` type and `jsonResponse(statusCode, body)` helper.
3. **`routes/<action>.ts`** — One file per route handler. Each exports a single async function that receives an `APIGatewayProxyEvent` and returns an `APIGatewayProxyResult`.

## Coding Standards

- All functions are to be commented in JSDoc style
- Lambda functions target Node.js 24

## Testing

Domain handler tests use Jest (configured in `src/domains/jest.config.js`). Tests live alongside source code in `__tests__/` directories.

```
src/domains/<name>/__tests__/
├── handler.test.ts   # Route dispatch tests for the Lambda entry point
├── utils.test.ts     # jsonResponse helper tests
└── routes.test.ts    # Individual route handler tests
```

Shared test utilities (e.g. `buildEvent` mock factory) are in `src/domains/test-utils.ts`.

```bash
# Run all domain tests (from src/domains/)
cd src/domains && npm test
```

## Commands

All CDK commands require the `ENV` environment variable.

```bash
# Build TypeScript (infrastructure)
cd infrastructure && npm run build

# Run domain tests
cd src/domains && npm test

# Synth CloudFormation template
ENV=dev npx cdk synth

# Deploy
ENV=dev npx cdk deploy

# Diff against deployed stack
ENV=dev npx cdk diff
```

## Adding a New Domain

1. Create `src/domains/<name>/` with `index.ts`, `utils.ts`, and `routes/` following existing patterns.
2. Create `infrastructure/lib/domain-<name>.ts` using `NodejsFunction` pointing to the handler entry file.
3. Accept `api` and `authorizer` via props; add `ANY` methods on root + sub-resources.
4. Wire the new stack in `infrastructure/bin/infrastructure.ts`.
5. Add a test in `infrastructure/test/` asserting the Lambda is created.
6. Add domain handler tests in `src/domains/<name>/__tests__/` (handler, utils, routes).

## General Expectations

- As you change files, you must appropriately modify instructions and documentation found in the CLAUDE.md files
- See `infrastructure/CLAUDE.md` for infrastructure-specific details
