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
- **`bot-executor.ts`** — SNS-triggered handler that evaluates a bot's rule tree against indicator data and records trade signals.
- **`bot-stream-handler.ts`** — DynamoDB Streams handler that manages SNS subscriptions when bots are created/updated/deleted.

## Trading Domain

The trading domain (`src/domains/trading/`) includes additional pure-logic modules:

- **`types.ts`** — Shared types (`BotRecord`, `TradeRecord`, `IndicatorSnapshot`, `Rule`, `RuleGroup`).
- **`indicators.ts`** — Technical indicator calculations (SMA, EMA, RSI, MACD, Bollinger Bands). No external dependencies.
- **`rule-evaluator.ts`** — Recursive rule tree evaluator supporting AND/OR groups with numeric and string operators.
- **`filter-policy.ts`** — Generates SNS filter policies from bot rule groups. Only extracts flat AND rules; nested OR groups are handled by the executor.

SNS filter strategy: top-level AND rules are converted to SNS MessageAttribute filter policies for pre-filtering. The bot executor Lambda re-evaluates the full rule tree for accuracy.

## Domain Reference

### Portfolio Domain (`src/domains/portfolio/`)

**Responsibility:** Manages user investment portfolios — CRUD operations for creating, listing, retrieving, updating, and deleting portfolios.

**DynamoDB Tables:** None (currently returns mock/placeholder data).

**Endpoints:**

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/portfolio` | `listPortfolios` | List all portfolios for the authenticated user |
| `POST` | `/portfolio` | `createPortfolio` | Create a new portfolio with a given name |
| `GET` | `/portfolio/{id}` | `getPortfolio` | Retrieve a single portfolio by ID |
| `PUT` | `/portfolio/{id}` | `updatePortfolio` | Update a portfolio's properties |
| `DELETE` | `/portfolio/{id}` | `deletePortfolio` | Delete a portfolio |

All endpoints are Cognito-protected. Infrastructure stack: `DomainPortfolioStack`.

---

### Orderbook Domain (`src/domains/orderbook/`)

**Responsibility:** Manages trading orders — CRUD operations for placing, listing, retrieving, updating, and cancelling orders.

**DynamoDB Tables:** None (currently returns mock/placeholder data).

**Endpoints:**

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/orderbook` | `listOrders` | List all orders for the authenticated user |
| `POST` | `/orderbook` | `placeOrder` | Place a new order (symbol, side, quantity) |
| `GET` | `/orderbook/{id}` | `getOrder` | Retrieve a single order by ID |
| `PUT` | `/orderbook/{id}` | `updateOrder` | Update an existing order (e.g. status) |
| `DELETE` | `/orderbook/{id}` | `cancelOrder` | Cancel an order |

All endpoints are Cognito-protected. Infrastructure stack: `DomainOrderbookStack`.

---

### Core Domain (`src/domains/core/`)

**Responsibility:** Cross-cutting platform features. Currently handles user feedback collection.

**DynamoDB Tables:**

| Table | Partition Key | Description |
|-------|--------------|-------------|
| `{name}-{env}-feedback` | `id` (STRING, UUID) | Stores user-submitted feedback with email, category, message, and timestamp |

**Endpoints:**

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `POST` | `/core/feedback` | `submitFeedback` | Submit user feedback (category, message). Extracts email from Cognito claims. Returns 201 with created item. |

Cognito-protected. Lambda has `dynamodb:PutItem` on the Feedback table. Infrastructure stack: `DomainCoreStack`.

---

### Trading Domain (`src/domains/trading/`)

**Responsibility:** Bot-based algorithmic trading — users define rule trees (AND/OR groups of indicator conditions) to create trading bots. Bots evaluate rules against real-time market indicators and record trade signals when conditions are met.

**DynamoDB Tables:**

| Table | Partition Key | Sort Key | GSIs | Stream | Description |
|-------|--------------|----------|------|--------|-------------|
| `{name}-{env}-trading-bots` | `sub` (user ID) | `botId` (UUID) | `subscriptionArn-index` (PK: `subscriptionArn`) | NEW_AND_OLD_IMAGES | Stores bot definitions with rule trees, status, and SNS subscription state |
| `{name}-{env}-trading-trades` | `botId` | `timestamp` (ISO) | `sub-index` (PK: `sub`, SK: `timestamp`) | — | Stores trade signal records with price and indicator snapshots |

**SNS Topic:** `{name}-{env}-trading-indicators` — distributes real-time indicator data to subscribed bots via per-bot filter policies.

**REST Endpoints (Cognito-protected):**

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `POST` | `/trading/bots` | `createBot` | Create a new bot (name, pair, action, rule tree). Defaults to `draft` status. |
| `GET` | `/trading/bots` | `listBots` | List all bots for the authenticated user |
| `GET` | `/trading/bots/{botId}` | `getBot` | Retrieve a single bot by ID (verifies ownership) |
| `PUT` | `/trading/bots/{botId}` | `updateBot` | Update bot fields (name, pair, action, status, query) |
| `DELETE` | `/trading/bots/{botId}` | `deleteBot` | Delete a bot (triggers SNS unsubscribe via stream handler) |
| `GET` | `/trading/trades` | `listTrades` | List all trade signals for the user (newest first, `?limit=N`, default 50) |
| `GET` | `/trading/trades/{botId}` | `listBotTrades` | List trade signals for a specific bot (verifies ownership, `?limit=N`, default 50) |

**Async Event Handlers:**

| Handler | Trigger | Description |
|---------|---------|-------------|
| `price-publisher.ts` | EventBridge (every 1 min) | Fetches 200 x 1m candles + 24h ticker from Binance for BTC/USDT, calculates 16 technical indicators (SMA, EMA, RSI, MACD, BB), publishes `IndicatorSnapshot` to SNS |
| `bot-executor.ts` | SNS (per-bot subscription) | Looks up bot by `subscriptionArn`, evaluates full rule tree against indicator data, records `TradeRecord` if rules match |
| `bot-stream-handler.ts` | DynamoDB Streams (Bots table) | Manages SNS subscriptions: subscribes on INSERT/activate, unsubscribes on REMOVE/deactivate, updates filter policy on query change |

Infrastructure stack: `DomainTradingStack`.

---

## Adding a New Domain Handler

1. Create `<name>/` with `index.ts`, `utils.ts`, and `routes/` following existing patterns.
2. Add tests in `<name>/__tests__/` (handler, utils, routes).
3. Wire the corresponding infrastructure stack — see `infrastructure/CLAUDE.md`.
