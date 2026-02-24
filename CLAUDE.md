# No-code Bot Trading

No-code bot trading is a SaaS platform that allows users to create rules in a drag-and-drop manner to construct trading bots.

These trading bots can then be deployed on exchanges such as Binance.

## Project Structure

```
src/
├── auth-page/            # Single-page app for authentication flows
├── webapp/               # Vite + React 19 authenticated dashboard (Cognito-gated)
├── website/              # Next.js 15 public marketing site
└── domains/              # Backend domain logic (Lambda handlers)
    ├── portfolio/        # Portfolio domain — CRUD via API Gateway
    │   ├── index.ts      # Lambda entry point + route dispatch
    │   ├── utils.ts      # jsonResponse helper & RouteHandler type
    │   └── routes/       # One file per route handler
    ├── orderbook/        # Orderbook domain — CRUD via API Gateway
    │   ├── index.ts
    │   ├── utils.ts
    │   └── routes/
    └── core/             # Core domain — cross-cutting platform features
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
    ├── domain-core.ts    # Core Lambda + DynamoDB Feedback table + API routes (DomainCoreStack)
    ├── auth-page.ts      # S3 + CloudFront for auth page SPA (AuthPageStack)
    ├── webapp.ts         # S3 + CloudFront for authenticated dashboard (WebappStack)
    └── website.ts        # S3 + CloudFront for public marketing site (WebsiteStack)
```

## Tech Stack

- **Runtime:** Node.js 24, TypeScript 5.9
- **Infrastructure:** AWS CDK v2 (`aws-cdk-lib@2.234.1`)
- **Auth:** AWS Cognito User Pools + AWS Amplify (client-side)
- **API:** API Gateway REST API with Cognito authorizer
- **Compute:** Lambda (bundled via `NodejsFunction` / esbuild)
- **Webapp:** Vite + React 19 + Material UI 6 + React Router 7
- **Region:** ap-southeast-2

## Coding Standards

- All functions are to be commented in JSDoc style
- Lambda functions target Node.js 24

## General Expectations

- As you change files, you must appropriately modify instructions and documentation found in the CLAUDE.md files
- See `infrastructure/CLAUDE.md` for CDK stacks, commands, and adding new stacks
- See `src/domains/CLAUDE.md` for domain handler patterns, testing, and adding new domains
- See `src/webapp/CLAUDE.md` for webapp commands
