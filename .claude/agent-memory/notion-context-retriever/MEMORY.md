# Notion Context Retriever Memory

## Page Hierarchy (Key IDs)

- Root: `3115ae86-48e7-8108-82bd-f15d8aa48ef7` — "Signalr (No-code Bot Trading Service)"
  - Features: `3125ae8648e781a693b1f27f061f273a`
    - Bot Configuration: `3115ae86-48e7-819b-b327-ca5854220443`
    - Backtesting: `3125ae86-48e7-81c5-b49b-ed0e379ea30c`
  - Product Specs: `3115ae86-48e7-81e3-bffd-c973f8c10490`
  - Architecture & Domains: `3115ae86-48e7-810c-8750-dea42d0117ce`
    - Trading Domain: `3115ae86-48e7-8181-9a24-c229d1b7f941`
    - Portfolio Domain: `3115ae86-48e7-81f4-b80e-df65aaca07ef`
      - Leaderboard (subdomain): `3115ae86-48e7-814f-ab10-f468d4c1f901`
    - Exchange Domain (merged Orderbook + Demo Exchange): `3115ae86-48e7-819a-9b37-ef4f5e5c6c9c`
      - Exchange API Reference: `3115ae86-48e7-8154-872f-ce363412fad0`
      - Exchange Endpoint Field Mappings: `3115ae86-48e7-8153-8ad1-c1f89be245df`
    - Executor Domain: `3135ae86-48e7-81b8-a40c-d9ef25e7dc0e`
    - Backtesting Domain: `3135ae86-48e7-816a-9eda-fc6ad7283ac7`
    - Core Domain: `3115ae86-48e7-81ad-b387-c240d807c2e3`
    - Demo Exchange Domain: MERGED INTO Exchange Domain — `3115ae86-48e7-819a-9b37-ef4f5e5c6c9c` (formerly "Orderbook Domain" in memory, now renamed "Exchange Domain")
    - Billing Domain: `3115ae86-48e7-816c-82cb-f71ad5380273`
  - Pricing & Tiers: `3115ae86-48e7-81e5-ba28-c86a9f20a7ba`
  - To-Do & Known Issues: `3115ae86-48e7-8104-a6d7-e66b58a59774`
  - Exchange Configuration: `3115ae86-48e7-81d8-9600-ea5f2e0b5468`
  - Overview & Target Audience: `3115ae86-48e7-81fe-ba15-d60b41a086e8`
  - Leaderboard & Copy Trading (feature spec): `3115ae86-48e7-8143-bc4a-e15c3d808add`
  - Product Specs: `3115ae86-48e7-81e3-bffd-c973f8c10490`
    - Overview & Target Audience: `3115ae86-48e7-81fe-ba15-d60b41a086e8`
    - Design Decisions: `3115ae86-48e7-81a3-9601-fb019823ca09`

## Key Documentation Locations

- **Bot deletion spec**: Trading Domain page (`3115ae86-48e7-8181-9a24-c229d1b7f941`) — REST Endpoints table, DELETE /trading/bots/{botId}
- **Bot performance table schema**: Trading Domain page — DynamoDB Tables section
- **Bot lifecycle (EventBridge events)**: Trading Domain page mentions BotCreated/BotUpdated/BotDeleted events published to EventBridge
- **Portfolio performance recorder**: Portfolio Domain page — reads bot-performance table directly via sub-index GSI
- **Bot configuration**: Bot Configuration page (`3115ae86-48e7-819b-b327-ca5854220443`)
- **Exchange configuration / demo mode**: Exchange Configuration page (`3115ae86-48e7-81d8-9600-ea5f2e0b5468`) under Features
- **Exchange domain spec (demo exchange + proxy)**: Exchange Domain page (`3115ae86-48e7-819a-9b37-ef4f5e5c6c9c`) — public API (/exchange/balance, /exchange/pairs, /exchange/orders), demo exchange internal API, DynamoDB schema (exchange-demo-balances, exchange-demo-orders), demo order flow, to-do
- **Exchange API Reference (auth + key validation)**: `3115ae86-48e7-8154-872f-ce363412fad0` — sub-page of Exchange Domain
- **Exchange Endpoint Field Mappings (request/response details)**: `3115ae86-48e7-8153-8ad1-c1f89be245df` — sub-page of Exchange Domain
- **Demo exchange balance seeding**: Exchange Domain page — seeds $1,000 USD on first interaction. Tables: exchange-demo-balances (sub PK, usd, btc), exchange-demo-orders (sub PK, orderId SK). Market Domain ID corrected: `3135ae8648e781329c40d7411d28f367`
- **Backtesting full spec**: Backtesting feature page (`3125ae86-48e7-81c5-b49b-ed0e379ea30c`) under Features
- **Backtesting technical impl**: Backtesting Domain page (`3135ae86-48e7-816a-9eda-fc6ad7283ac7`) — engine, Step Functions, S3, DynamoDB schema, REST endpoints, to-do
- **P&L calculation (bot-level)**: Analytics Domain page (`3115ae86-48e7-81f4-b80e-df65aaca07ef`) — bot-perf-recorder reads executor-trades table via sub-index GSI; computes realisedPnl, unrealisedPnl, netPnl
- **P&L calculation (portfolio-level)**: Analytics Domain page — portfolio-perf-recorder aggregates latest bot snapshots; stores totalNetPnl, totalRealisedPnl, totalUnrealisedPnl, pnl24h
- **Trades table (source data)**: Executor Domain page (`3135ae86-48e7-81b8-a40c-d9ef25e7dc0e`) — executor-trades: botId (PK), timestamp (SK), sub, pair, action, price, indicators
- **Leaderboard metrics + copy trading**: Leaderboard Subdomain page (`3115ae86-48e7-814f-ab10-f468d4c1f901`) — leaderboard-metrics table, mirror-subscriptions table, % return ranking

## Documentation Gaps

- **Account deletion / user data cleanup**: Account Domain page (`3115ae86-48e7-81ad-b387-c240d807c2e3`) DOES document cross-domain deletion — deletes from exchange-demo-balances, analytics tables, portfolio table, bots, trades, then Cognito user.
- **Dashboard/Portfolio UI page specs**: No dedicated dashboard or portfolio page spec exists in the Notion workspace. The analytics API endpoints are documented in Analytics Domain, but no UX wireframe or page layout spec for the webapp dashboard or portfolio view has been written.
- **Settings page (UI)**: No dedicated settings page feature spec. Only Trading Domain settings (exchange, base currency, API keys) are documented under the Trading Domain and Exchange Configuration pages.
- **Signup flow**: No dedicated auth or signup flow documentation page exists anywhere in the workspace.
- **Portfolio table username field**: CORRECTED — the `{name}-{env}-portfolio` table DOES store `username` (public username chosen at signup, immutable, unique). Previous note was wrong.

## Key Schema Update

- **Portfolio table**: `sub` (PK), `username` (String, immutable, unique — with `username-index` GSI for uniqueness enforcement), `createdAt`. Lives in AuthStack.
- **Username validation**: 3–20 chars, alphanumeric + underscores only. Enforced by `portfolio-pre-signup` Cognito trigger.

## Architecture Patterns

- DynamoDB naming: `{name}-{env}-{table}` where name=`techniverse`, env=`prod`
- All REST endpoints are Cognito-protected
- Domains must NOT directly access another domain's DynamoDB (except known deviation: portfolio-perf-recorder reads trading bot-performance table directly)
- EventBridge used for cross-domain async events (BotCreated, BotUpdated, BotDeleted)
- SNS used for distributing market data (indicator snapshots) to subscribed bots
