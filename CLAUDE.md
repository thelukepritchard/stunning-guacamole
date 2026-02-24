# No-code Bot Trading

No-code bot trading is a SaaS platform that allows users to create rules in a drag-and-drop manner to construct trading bots.

These trading bots can then be deployed on exchanges such as Binance.

## Project Structure

```
src/
├── shared/               # Framework-agnostic shared code
│   └── styles/           # Shared design system (tokens + global CSS)
│       ├── tokens.ts     # TypeScript design tokens (colours, typography, effects)
│       └── global.css    # CSS custom properties + global base styles
├── auth-page/            # Single-page app for authentication flows
├── webapp/               # Vite + React 19 authenticated dashboard (Cognito-gated)
├── website/              # Vite + React 19 public marketing site
└── domains/              # Backend domain logic (Lambda handlers)
    ├── portfolio/        # Portfolio domain — CRUD via API Gateway
    │   ├── index.ts      # Lambda entry point + route dispatch
    │   ├── utils.ts      # jsonResponse helper & RouteHandler type
    │   └── routes/       # One file per route handler
    ├── orderbook/        # Orderbook domain — CRUD via API Gateway
    │   ├── index.ts
    │   ├── utils.ts
    │   └── routes/
    ├── core/             # Core domain — cross-cutting platform features
    │   ├── index.ts
    │   ├── utils.ts
    │   └── routes/
    └── trading/          # Trading domain — bots, indicators, trade signals
        ├── index.ts      # Lambda entry point + route dispatch
        ├── utils.ts      # jsonResponse helper & RouteHandler type
        ├── types.ts      # Shared types (BotRecord, TradeRecord, IndicatorSnapshot)
        ├── indicators.ts # Technical indicator calculations (SMA, EMA, RSI, MACD, BB)
        ├── rule-evaluator.ts  # Recursive rule tree evaluator
        ├── filter-policy.ts   # SNS filter policy generator
        ├── routes/       # API route handlers (CRUD bots + trades)
        └── async/        # Event-driven handlers
            ├── price-publisher.ts    # EventBridge -> Binance -> SNS
            ├── bot-executor.ts       # SNS -> rule eval -> trade record
            └── bot-stream-handler.ts # DynamoDB Streams -> SNS subscriptions

infrastructure/           # AWS CDK v2 project (separate package)
├── bin/infrastructure.ts # CDK app entry point
└── lib/
    ├── auth.ts           # Cognito User Pool + Client (AuthStack)
    ├── rest-api.ts       # API Gateway REST API + Cognito Authorizer (RestApiStack)
    ├── domain-portfolio.ts   # Portfolio Lambda + API routes (DomainPortfolioStack)
    ├── domain-orderbook.ts   # Orderbook Lambda + API routes (DomainOrderbookStack)
    ├── domain-core.ts    # Core Lambda + DynamoDB Feedback table + API routes (DomainCoreStack)
    ├── domain-trading.ts # Trading Lambda (4 functions) + DynamoDB (bots + trades) + SNS + EventBridge (DomainTradingStack)
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
- **Website:** Vite + React 19 + Material UI 6 + React Router 7
- **Region:** ap-southeast-2

## Shared Styles

Design tokens and global CSS live in `src/shared/styles/` and are shared between the webapp and website.

- **`tokens.ts`** — TypeScript constants for colours, typography, gradients, effects, radii. Import as `@shared/styles/tokens` (via path alias).
- **`global.css`** — CSS custom properties (mirroring the tokens) plus global base styles (scrollbar, selection, font smoothing). Import as `@shared/styles/global.css`.
- **Webapp integration** — The `@shared` alias is configured in both `vite.config.ts` (resolve alias) and `tsconfig.json` (paths). The MUI theme (`src/webapp/src/theme.ts`) is built from the shared tokens.
- **Website integration** — The `@shared` alias is configured in both `vite.config.ts` (resolve alias) and `tsconfig.json` (paths). The MUI theme (`src/website/src/theme.ts`) is built from the shared tokens.

## Coding Standards

- All functions are to be commented in JSDoc style
- Lambda functions target Node.js 24

## General Expectations

- As you change files, you must appropriately modify instructions and documentation found in the CLAUDE.md files
- See `infrastructure/CLAUDE.md` for CDK stacks, commands, and adding new stacks
- See `src/domains/CLAUDE.md` for domain handler patterns, testing, and adding new domains
- See `src/webapp/CLAUDE.md` for webapp commands
- See `src/website/CLAUDE.md` for website commands
