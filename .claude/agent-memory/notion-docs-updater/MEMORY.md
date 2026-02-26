# Notion Docs Updater — Agent Memory

## Notion Workspace Structure

- Root page: "Signalr (No-code Bot Trading Service)" — ID: `3115ae86-48e7-8108-82bd-f15d8aa48ef7`
- Architecture & Domains: `3115ae86-48e7-810c-8750-dea42d0117ce` — high-level AWS overview, links to domain pages
- Trading Domain: `3115ae86-48e7-8181-9a24-c229d1b7f941` — DynamoDB schemas, Lambda functions, REST endpoints, SNS topic, backtesting
- Bot Configuration: `3115ae86-48e7-819b-b327-ca5854220443` — under "Features" (`3125ae8648e781a693b1f27f061f273a`)
- Portfolio Domain: `3115ae86-48e7-81f4-b80e-df65aaca07ef`
- Orderbook Domain: `3115ae86-48e7-819a-9b37-ef4f5e5c6c9c`
- Core Domain: `3115ae86-48e7-81ad-b387-c240d807c2e3`
- Billing Domain: `3115ae86-48e7-816c-82cb-f71ad5380273`
- Leaderboard Domain: `3115ae86-48e7-814f-ab10-f468d4c1f901`
- Exchange Configuration: `3115ae86-48e7-81d8-9600-ea5f2e0b5468`
- To-Do & Known Issues: `3115ae86-48e7-8104-a6d7-e66b58a59774`

## Tool Usage Notes

- Use `mcp__claude_ai_Notion__notion-fetch` with `id` param (not `url`) — the URL form fails
- `mcp__claude_ai_Notion__notion-search` is reliable for finding pages by topic
- `replace_content_range` uses `selection_with_ellipsis` — match exact whitespace from the fetched content
- Always re-fetch a page before updating if a prior edit to it was made in the same session (content may have changed)

## Trading Domain Architecture (Current — as of 2026-02-26)

### Lambda Functions (7 total)
1. `trading-handler` — API Lambda entry point
2. `trading-price-publisher` — EventBridge 1-min schedule → Binance → SNS + price history DynamoDB
3. `trading-bot-executor` — SNS (single static subscription) → queries active bots by pair via `pair-status-index` GSI → evaluates buy/sell rules → records trades
4. `trading-bot-perf-recorder` — EventBridge 5-min schedule → P&L snapshots
5. `trading-backtest-validate` — Step Functions step 1
6. `trading-backtest-engine` — Step Functions step 3
7. `trading-backtest-write-report` — Step Functions step 4

### Removed (old architecture)
- `bot-lifecycle-handler` Lambda — dynamically managed per-bot SNS subscriptions (removed)
- `filter-policy.ts` — generated per-action SNS filter policies (removed)

### DynamoDB bots table GSI
- Current: `pair-status-index` (PK: `pair`, SK: `status`) — used by bot-executor fan-out
- Old (removed): `buySubscriptionArn-index`, `sellSubscriptionArn-index`

### SNS
- Single static Lambda subscription on `{name}-{env}-trading-indicators`
- Bot-executor fans out internally to all active bots for the pair

### BotRecord
- No `buySubscriptionArn` or `sellSubscriptionArn` fields (removed)

## Documentation Patterns

- Trading Domain page organises content as: Trading Settings → DynamoDB Tables → REST Endpoints → Backtesting → General To-Do
- Bot Configuration page is a feature spec (not a domain spec) — lives under Features, not Architecture & Domains
- Tables use Notion HTML table syntax in the markdown content
- Checked/unchecked todo items use `- [x]` / `- [ ]` syntax
