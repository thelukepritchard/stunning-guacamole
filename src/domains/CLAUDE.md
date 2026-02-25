# Domains

Backend domain logic implemented as Lambda handlers, deployed via API Gateway.

## Handler Pattern

Each domain under `src/domains/<name>/` follows this convention:

1. **`index.ts`** — Lambda entry point. Builds a route key from `event.httpMethod` + `event.resource` and dispatches via a `switch` statement.
2. **`utils.ts`** — Exports `RouteHandler` type and `jsonResponse(statusCode, body)` helper.
3. **`routes/<action>.ts`** — One file per route handler. Each exports a single async function that receives an `APIGatewayProxyEvent` and returns an `APIGatewayProxyResult`.

## Testing

Tests use Jest (configured in `jest.config.js`) and live alongside source code in `__tests__/` directories.

```
<name>/__tests__/
├── handler.test.ts   # Route dispatch tests for the Lambda entry point
├── utils.test.ts     # jsonResponse helper tests
└── routes.test.ts    # Individual route handler tests
```

Shared test utilities (e.g. `buildEvent` mock factory) are in `test-utils.ts`.

## Commands

```bash
# Run all domain tests
npm test
```

## Async Handlers

Domains with event-driven processing place async handlers in `<name>/async/`:

- **`price-publisher.ts`** — EventBridge-triggered handler that fetches market data from Binance, calculates technical indicators, and publishes to SNS.
- **`bot-executor.ts`** — SNS-triggered handler that evaluates a bot's buy and sell rule trees against indicator data using the bot's execution mode (`once_and_wait` or `condition_cooldown`), records trade signals for each matching action, and updates execution state in DynamoDB. For `condition_cooldown` mode, supports per-action cooldown via `buyCooldownUntil`/`sellCooldownUntil` timestamps (computed from `cooldownMinutes`). Buy and sell cooldowns are independent.
- **`bot-lifecycle-handler.ts`** — EventBridge handler that manages SNS subscriptions in response to bot lifecycle events (`BotCreated`, `BotUpdated`, `BotDeleted`). Published by API route handlers after DDB writes.

## Trading Domain

The trading domain (`src/domains/trading/`) includes additional pure-logic modules:

- **`types.ts`** — Shared types (`BotRecord`, `TradeRecord`, `IndicatorSnapshot`, `Rule`, `RuleGroup`, `ExecutionMode`) and EventBridge event types (`BotCreatedDetail`, `BotUpdatedDetail`, `BotDeletedDetail`, `TRADING_EVENT_SOURCE`).
- **`indicators.ts`** — Technical indicator calculations (SMA, EMA, RSI, MACD, Bollinger Bands). No external dependencies.
- **`rule-evaluator.ts`** — Recursive rule tree evaluator supporting AND/OR groups with numeric and string operators.
- **`filter-policy.ts`** — Generates SNS filter policies from bot buy/sell rule groups. When only one action exists, extracts flat AND rules for pre-filtering. When both exist, falls back to pair-only filtering. Nested OR groups are handled by the executor.

SNS filter strategy: top-level AND rules from a single action query are converted to SNS MessageAttribute filter policies for pre-filtering. When a bot has both buyQuery and sellQuery, the filter falls back to pair-only (since rule conditions may conflict). The bot executor Lambda re-evaluates the full rule trees for accuracy.

## Adding a New Domain Handler

1. Create `<name>/` with `index.ts`, `utils.ts`, and `routes/` following existing patterns.
2. Add tests in `<name>/__tests__/` (handler, utils, routes).
3. Wire the corresponding infrastructure stack — see `infrastructure/CLAUDE.md`.
