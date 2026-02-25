# Signalr

Signalr is a SaaS platform that allows users to create rules in a drag-and-drop manner to construct trading bots.

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
    ├── portfolio/        # Portfolio domain — user portfolios, performance tracking, leaderboard
    │   ├── index.ts      # Lambda entry point + route dispatch
    │   ├── types.ts      # Shared types (PortfolioRecord, PortfolioPerformanceRecord)
    │   ├── utils.ts      # jsonResponse helper & RouteHandler type
    │   ├── routes/       # API route handlers (portfolio, performance, leaderboard)
    │   └── async/        # Event-driven handlers
    │       ├── pre-signup.ts                  # Cognito pre-sign-up trigger -> validate username uniqueness
    │       ├── post-confirmation.ts           # Cognito post-confirmation trigger -> create portfolio entry with username
    │       └── portfolio-performance-recorder.ts # EventBridge 5-min schedule -> aggregated P&L snapshots
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
        ├── types.ts      # Shared types (BotRecord, TradeRecord, SizingConfig, StopLossConfig, TakeProfitConfig, PriceHistoryRecord, BotPerformanceRecord, IndicatorSnapshot) + EventBridge event types
        ├── indicators.ts # Technical indicator calculations (SMA, EMA, RSI, MACD, BB)
        ├── rule-evaluator.ts  # Recursive rule tree evaluator
        ├── filter-policy.ts   # SNS filter policy generator
        ├── routes/       # API route handlers (CRUD bots + trades + price history + bot performance + exchange configs), publish EventBridge events
        └── async/        # Event-driven handlers
            ├── price-publisher.ts         # EventBridge schedule -> Binance -> SNS + price history DynamoDB
            ├── bot-executor.ts            # SNS -> rule eval -> trade record
            ├── bot-lifecycle-handler.ts   # EventBridge bot events -> SNS subscriptions
            └── bot-performance-recorder.ts # EventBridge 5-min schedule -> P&L snapshots

infrastructure/           # AWS CDK v2 project (separate package)
├── bin/infrastructure.ts # CDK app entry point
└── lib/
    ├── auth.ts           # Cognito User Pool + Client + Portfolio table (with username GSI) + pre-signup + post-confirmation triggers (AuthStack)
    ├── rest-api.ts       # API Gateway REST API + Cognito Authorizer (RestApiStack)
    ├── domain-portfolio.ts   # Portfolio Lambda (2 functions) + DynamoDB (portfolio-performance) + EventBridge 5-min schedule + API routes (DomainPortfolioStack)
    ├── domain-orderbook.ts   # Orderbook Lambda + API routes (DomainOrderbookStack)
    ├── domain-core.ts    # Core Lambda + DynamoDB Feedback table + API routes (DomainCoreStack)
    ├── domain-trading.ts # Trading Lambda (5 functions) + DynamoDB (bots + trades + price-history + bot-performance + settings) + KMS + SNS + EventBridge events (DomainTradingStack)
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

## Agents

This project has custom agents in `.claude/agents/`. Use these instead of doing the work manually:

- **infra-deployer** — Deploys infrastructure to AWS via `ENV=prod cdk deploy`. Use whenever the user wants to deploy, push to prod, or run CDK. Do not run CDK deploy commands manually.
- **notion-context-retriever** — Searches the Notion workspace for project documentation. Use proactively before implementing or modifying any feature to ensure alignment with specs. Also use when the user asks how something works.
- **tech-lead-reviewer** — Reviews code for completeness, coding standards, security, and quality. Use proactively after completing a feature, fixing a bug, or making significant code changes.
- **lead-tester** — Runs tests, identifies coverage gaps, and writes missing tests. Use proactively after writing or modifying any meaningful code.

### Agent workflow

When completing a feature or significant code change, follow this workflow:
1. **Before starting**: Launch `notion-context-retriever` to fetch relevant documentation (Note you may also call this at anytime to retrieve documentation)
2. **After writing code**: Launch `lead-tester` to verify tests pass and coverage is adequate. This only needs to ran when a function in a domain is modified.
3. **After tests pass**: Launch `tech-lead-reviewer` to review code quality and standards. Only do this when the task is multiple file changes
4. **When deploying**: Launch `infra-deployer` to deploy infrastructure changes

## General Expectations

- As you change files, you must appropriately modify instructions and documentation found in the CLAUDE.md files
- See `infrastructure/CLAUDE.md` for CDK stacks, commands, and adding new stacks
- See `src/domains/CLAUDE.md` for domain handler patterns, testing, and adding new domains
- See `src/webapp/CLAUDE.md` for webapp commands
- See `src/website/CLAUDE.md` for website commands

## Documentation

Documentation for this service will live long term in Notion under the "Signalr (No-code Bot Trading Service)" space. 
As we work, you need to ensure what we're doing is correct according to the Notion documentation. 
You are expected to update this documentation as we work also.
It is expected to keep coding standards and reposoitory specific content in CLAUDE.md files, and technical and business documentation in Notion