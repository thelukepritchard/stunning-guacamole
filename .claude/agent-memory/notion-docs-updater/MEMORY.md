# Notion Docs Updater — Agent Memory

## Notion Workspace Structure

- Root page: "Signalr (No-code Bot Trading Service)" — ID: `3115ae86-48e7-8108-82bd-f15d8aa48ef7`
- Architecture & Domains: `3115ae86-48e7-810c-8750-dea42d0117ce` — domain overview, AWS infra, data flow, event bus
- **Bots Domain**: `3115ae86-48e7-8181-9a24-c229d1b7f941` — bot CRUD, settings, KMS, /bots + /settings endpoints
- **Analytics Domain**: `3115ae86-48e7-81f4-b80e-df65aaca07ef` — performance tracking, leaderboard, trader profiles
- **Exchange Domain**: `3115ae86-48e7-819a-9b37-ef4f5e5c6c9c` — exchange proxy + demo exchange, /exchange endpoints
- **Account Domain**: `3115ae86-48e7-81ad-b387-c240d807c2e3` — feedback, account deletion, auth triggers
- **Market Domain**: `3135ae8648e781329c40d7411d28f367` — price ingestion, SNS, /market/prices/{pair}
- **Executor Domain**: `3135ae86-48e7-81b8-a40c-d9ef25e7dc0e` — rule evaluation, trades, /trades endpoints (NEW)
- **Backtesting Domain**: `3135ae86-48e7-816a-9eda-fc6ad7283ac7` — Step Functions workflow, /backtests endpoints (NEW)
- Billing Domain: `3115ae86-48e7-816c-82cb-f71ad5380273` — not yet updated
- Leaderboard: `3115ae86-48e7-814f-ab10-f468d4c1f901` — child of Analytics Domain (renamed from "Portfolio Subdomain")
- Exchange API Reference: `3115ae8648e78154872fce363412fad0` — child of Exchange Domain
- Exchange Endpoint Field Mappings: `3115ae8648e781538ad1c1f89be245df` — child of Exchange Domain
- To-Do & Known Issues: `3115ae86-48e7-8104-a6d7-e66b58a59774`

## Domain Restructure (completed 2026-02-27)

Old → New domain mapping:
- Trading → split into: **Bots** + **Executor** + **Backtesting**
- Portfolio → **Analytics**
- Orderbook + Demo Exchange → **Exchange**
- Core → **Account**
- New: **Market** (was part of Trading)
- New: **shared** module (no stack, no routes — `src/domains/shared/`)

## Current Domain Architecture (as of 2026-02-27)

### CDK Stacks and API Roots
- `DomainBotsStack` → `/bots`, `/settings`
- `DomainMarketStack` → `/market`
- `DomainExecutorStack` → `/trades`
- `DomainExchangeStack` → `/exchange` (also owns internal demo exchange API)
- `DomainAnalyticsStack` → `/analytics`
- `DomainBacktestingStack` → `/backtests`
- `DomainAccountStack` → `/feedback`, `/account`

### DynamoDB Table Names (current)
- `{name}-{env}-portfolio` — AuthStack
- `{name}-{env}-bots` — Bots (GSI: pair-status-index)
- `{name}-{env}-bots-settings` — Bots
- `{name}-{env}-executor-trades` — Executor (GSI: sub-index)
- `{name}-{env}-market-price-history` — Market (30-day TTL)
- `{name}-{env}-analytics-bot-performance` — Analytics (90-day TTL, GSI: sub-index)
- `{name}-{env}-analytics-portfolio-performance` — Analytics (90-day TTL)
- `{name}-{env}-backtesting-backtests` — Backtesting (GSI: botId-index)
- `{name}-{env}-exchange-demo-balances` — Exchange
- `{name}-{env}-exchange-demo-orders` — Exchange
- `{name}-{env}-account-feedback` — Account

### Other Resources
- KMS: `{name}-{env}-bots-exchange-credentials` — Bots
- SNS: `{name}-{env}-market-indicators` — Market
- S3: `{name}-{env}-backtesting-reports` — Backtesting
- Step Functions: `{name}-{env}-backtesting-workflow` — Backtesting
- Demo API Gateway: `{name}-{env}-demo-exchange-api` (regional, unauthenticated) — Exchange

### EventBridge
- All Bots events use source: `signalr.bots` (formerly `TRADING_EVENT_SOURCE`)
- Events: `BotCreated`, `BotUpdated`, `BotDeleted` (Bots domain), `BacktestCompleted` (Backtesting)

### Shared Module
- `src/domains/shared/types.ts` — all cross-domain types
- `src/domains/shared/indicators.ts` — SMA, EMA, RSI, MACD, BB
- `src/domains/shared/rule-evaluator.ts` — recursive AND/OR tree evaluator

## Tool Usage Notes

- Use `mcp__claude_ai_Notion__notion-fetch` with `id` param (not `url`) — the URL form fails
- `replace_content` fails if child pages exist and aren't included — use `<page url="...">` tags
- New child pages created via `create-pages` are appended after content, not at the top
- Tables in Notion content use `<table header-row="true">` HTML syntax
- Callout blocks render from `>` blockquote markdown
- Code blocks use triple backtick with language identifier

## Documentation Patterns

- Domain pages follow: source path → description → infrastructure stack → DynamoDB tables → Lambda functions → REST endpoints → To-Do
- Architecture & Domains page uses plain text domain descriptions (no markdown tables in headers — they cause validation errors)
- Bot Configuration page is a feature spec under Features, not Architecture
- Checked/unchecked todo items use `- [x]` / `- [ ]` syntax
- Large `replace_content` blocks can fail with validation_error if content is too long — split into smaller edits if needed
