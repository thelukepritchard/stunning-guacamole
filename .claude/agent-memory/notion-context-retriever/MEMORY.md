# Notion Context Retriever Memory

## Page Hierarchy (Key IDs)

- Root: `3115ae86-48e7-8108-82bd-f15d8aa48ef7` — "Signalr (No-code Bot Trading Service)"
  - Features: `3125ae8648e781a693b1f27f061f273a`
    - Bot Configuration: `3115ae86-48e7-819b-b327-ca5854220443`
  - Product Specs: `3115ae86-48e7-81e3-bffd-c973f8c10490`
  - Architecture & Domains: `3115ae86-48e7-810c-8750-dea42d0117ce`
    - Trading Domain: `3115ae86-48e7-8181-9a24-c229d1b7f941`
    - Portfolio Domain: `3115ae86-48e7-81f4-b80e-df65aaca07ef`
      - Leaderboard (subdomain): `3115ae86-48e7-814f-ab10-f468d4c1f901`
    - Orderbook Domain: `3115ae86-48e7-819a-9b37-ef4f5e5c6c9c`
    - Core Domain: `3115ae86-48e7-81ad-b387-c240d807c2e3`
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
- **Exchange configuration**: Exchange Configuration page (`3115ae86-48e7-81d8-9600-ea5f2e0b5468`)

## Documentation Gaps

- **Username/display name**: No dedicated spec page. The only mention is in Leaderboard & Copy Trading feature page ("Trader username / display name" in leaderboard row display). No requirements for username format, validation, or storage location are documented.
- **Signup flow**: No dedicated auth or signup flow documentation page exists anywhere in the workspace.
- **Portfolio table lacks username**: The `{name}-{env}-portfolio` DynamoDB table schema only stores `sub`, `email`, and `createdAt` — no username field documented.

## Architecture Patterns

- DynamoDB naming: `{name}-{env}-{table}` where name=`techniverse`, env=`prod`
- All REST endpoints are Cognito-protected
- Domains must NOT directly access another domain's DynamoDB (except known deviation: portfolio-perf-recorder reads trading bot-performance table directly)
- EventBridge used for cross-domain async events (BotCreated, BotUpdated, BotDeleted)
- SNS used for distributing market data (indicator snapshots) to subscribed bots
