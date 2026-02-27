# Tech Lead Reviewer Memory

## Project: stunning-guacomole

### IAM Grant Conventions (CDK)
- `grantReadData` = GetItem, BatchGetItem, Scan, Query, ConditionCheckItem, DescribeTable
- `grantWriteData` = PutItem, BatchWriteItem, UpdateItem, DeleteItem
- `grantReadWriteData` = all of the above
- For delete-cleanup patterns (Query + BatchWriteItem), `grantReadWriteData` is the standard used here — not broken into granular grants.
- Least-privilege note: `grantReadWriteData` is broader than Query+BatchWriteItem but is the project-wide convention.

### Common Bug Patterns Found
- `BatchWriteCommand` does not retry `UnprocessedItems` — this is a recurring omission across delete/cleanup handlers. Always flag it.
- Bot existence is not checked before deletion (delete-then-check pattern) — this causes 200 returns for non-existent bots. Flag as a quality issue.
- DynamoDB `ProjectionExpression` with `#alias` placeholders: the alias must appear in `ExpressionAttributeNames`. Missing it causes a runtime `ValidationException`. Verified in bot-executor.ts GSI query (fixed in review).

### SNS Fan-out Pattern (bot-executor)
- `pair-status-index` GSI on `botsTable`: PK=`pair` (STRING), SK=`status` (STRING). Used by bot-executor to query all active bots for a pair.
- bot-executor uses a two-phase lookup: GSI query (ProjectionExpression: sub + botId only) → GetItem with ConsistentRead:true per key. The consistent read catches status changes that happened between GSI index propagation and actual execution.
- Single static `LambdaSubscription` from `indicatorsTopic` to `botExecutorHandler` — no filter policy, all pairs delivered to one Lambda.
- `queriesChanged` field on `BotUpdatedDetail` is now used to gate backtest staleness marking (was previously used by lifecycle handler for SNS subscription management).

### Domain Grant Patterns
- `botPerformanceTable` on `tradingApiHandler`: `grantReadWriteData` (needed for delete cleanup + read for GET performance)
- `tradesTable` on `tradingApiHandler`: `grantReadWriteData` (needed for delete cleanup + read for list trades)
- `priceHistoryTable` on `tradingApiHandler`: `grantReadData` (API only reads — no write routes)
- `botsTable` on `tradingApiHandler`: `grantReadWriteData` (CRUD)
- `settingsTable` on `tradingApiHandler`: `grantReadWriteData` (GET + PUT settings)

### Stack Architecture Notes
- `botPerformanceTable` is exposed as `public readonly` on `DomainTradingStack` and passed to `DomainPortfolioStack` for cross-domain reads.
- Trading domain: 7 Lambda functions — API handler, price publisher, bot executor, bot performance recorder, backtest-validate, backtest-engine, backtest-write-report. (Lifecycle handler was removed in the static SNS subscription refactor.)
- `botPerformanceTable` GSI `sub-index` is used by portfolio domain for user-level aggregation.
- Portfolio table lives in `AuthStack` (not `DomainPortfolioStack`) to avoid circular dependency with the post-confirmation trigger.
- `username-index` GSI on the portfolio table uses `ProjectionType.KEYS_ONLY` — pre-signup Lambda only needs to check existence, not read attributes.
- Pre-signup Lambda needs only `grantReadData` (Query GSI). Post-confirmation Lambda needs only `grantWriteData` (PutItem). Both are correctly scoped.

### Async Handler Testing Gaps
- There are no unit tests for `async/pre-signup.ts` or `async/post-confirmation.ts`. The project does not currently test Cognito trigger handlers. Flag as a coverage gap when reviewing.
- `post-confirmation.ts` now also creates a default bot — the bot creation path has no test either. Both are known gaps.

### Default Bot Creation Pattern (post-confirmation)
- The `createDefaultBot` helper in `post-confirmation.ts` writes directly to `BOTS_TABLE_NAME` env var using PutCommand. No conditional expression — so if a duplicate trigger fires after portfolio was already created the bot creation path IS still reached (only the portfolio write is guarded by `attribute_not_exists`). This is intentional design: bot is only created once because the `return event` early-exit in the portfolio `ConditionalCheckFailedException` branch prevents `createDefaultBot` from being called on retries.
- Bot item shape written must match `BotRecord` interface — confirmed all required fields are present (sub, botId, name, pair, status, executionMode, buySizing, sellSizing, buyQuery, sellQuery, createdAt, updatedAt).
- `rule.value` in `buyQuery`/`sellQuery` should be a string per `Rule` interface — correctly uses `'40'` and `'60'` (strings), not numbers.
- `botsTable` name in auth.ts uses deterministic pattern `${name}-${environment}-trading-bots` to avoid circular dependency. Confirmed match with domain-trading.ts table name.
- IAM: `botsTableRef.grantWriteData(postConfirmationHandler)` — PutItem only needed, grantWriteData is slightly broad (also grants BatchWriteItem, UpdateItem, DeleteItem) but consistent with project convention.

### Infrastructure Test Gaps (Auth feature)
- When new Lambda functions are added to AuthStack (e.g. pre-signup trigger), `infrastructure/test/infrastructure.test.ts` must be updated to assert the new function. This was omitted for the pre-signup Lambda.

### Username Uniqueness Race Condition — Known Pattern
- Cognito pre-signup + GSI uniqueness check has an inherent TOCTOU race: two concurrent signups with the same username can both pass the GSI check before either writes to DynamoDB. The check is best-effort only; true uniqueness enforcement requires a conditional write or a dedicated lock table. Always document this caveat when reviewing this pattern.

### Demo Exchange Domain (added)
- Standalone unauthenticated API Gateway (REGIONAL, not EDGE-optimized) — intentional design; called internally by Orderbook Lambda, not by end users.
- DynamoDB tables: `demo-exchange-balances` (PK: sub), `demo-exchange-orders` (PK: sub, SK: orderId).
- IAM grants use `table.grant(handler, ...)` with individual action strings — NOT the standard `grantReadData`/`grantWriteData` helpers. This is the project's own IAM grant approach; both styles are valid but the `grant()` method is more granular.
- `ensureBalance` uses conditional PutItem (`attribute_not_exists(sub)`) + re-read on race — correct concurrent-safe seeding pattern.
- `ScanIndexForward: false` on `listOrders` QueryCommand: works for ordering by SK (orderId = UUID) but UUIDs are not time-ordered, so this does NOT guarantee "most recent first". Should use a timestamp SK or a createdAt sort GSI for reliable ordering.
- `cancelOrder` does NOT write the cancellation to DynamoDB — it only checks status and returns a response. The `status` field is never updated to 'cancelled', making the cancel endpoint non-functional for future limit orders.
- `place-order.ts`: if the PutCommand for the order record throws (after balance was already debited), there is no rollback. Balance would be lost without a corresponding order record.
- CLAUDE.md (root) not updated to document the new demo-exchange domain.
- Infrastructure CLAUDE.md step 6 says "Add a test in test/infrastructure.test.ts" — no infrastructure test directory exists in this project.

### Account Deletion Feature (core domain)
- `deleteAllByPartitionKey` has a `ProjectionExpression` bug: when `skName` is provided, the expression is `#pk, ${skName}` — `#pk` resolves correctly via `ExpressionAttributeNames`, but `${skName}` is a raw attribute name (e.g. `timestamp`) that collides with a DynamoDB reserved word. Must alias skName too (`#sk`) and add it to `ExpressionAttributeNames`. Same issue in `deleteAllByGsi` — both `tablePkName` and `tableSkName` are passed raw, no alias.
- `deleteAllByGsi` calls `BatchWriteCommand` without retrying `UnprocessedItems` — recurring project bug. Always flag.
- `deleteAllByPartitionKey` with no `skName` calls a plain `DeleteCommand` on a table using just PK; this is correct for single-PK tables. Verified: portfolioTable (PK: sub, no SK), settingsTable (PK: sub, no SK), demoBalancesTable (PK: sub, no SK).
- Trades table PK is `botId` (not `sub`) — the GSI `sub-index` is the correct path for user-scoped deletion. Correctly uses `deleteAllByGsi`.
- `botPerformanceTable` PK is also `botId` — same GSI `sub-index` pattern is correct.
- `BacktestMetadataRecord` has PK `sub` + SK `backtestId` — `deleteAllByPartitionKey` with skName='backtestId' is correct.
- Cognito `AdminDisableUser` + `AdminDeleteUser` pattern: disable first, then delete. Correct approach to invalidate active sessions before removal.
- `cognito:username` claim is used for Cognito admin operations, `sub` for DynamoDB. Both extracted from JWT claims. If `username` is empty string (e.g. federated user with no username), `AdminDisableUser` will fail.
- No error handling around `AdminDisableUser` — if it fails (e.g. user already disabled), the function throws and Cognito deletion is never reached.
- No try/catch in `deleteAccount` — any DynamoDB or S3 failure will abort the flow mid-deletion, leaving partial data. Account should be deleted atomically or at least Cognito deletion must happen even if data cleanup partially fails.
- Test coverage missing: `deleteAccount` has no test in `routes.test.ts`. `handler.test.ts` also does not test `DELETE /core/account` routing.
- CDK `grantReadData` on `fromTableName` refs does NOT include GSI ARNs automatically — a separate `addToRolePolicy` for GSI ARNs is required. This is correctly done for trades and bot-performance GSIs via `addToRolePolicy`. However, `table.grant(handler, 'dynamodb:Query', ...)` on a table imported via `fromTableName` grants the table base ARN only — the GSI policy statement must be added separately, which it is.
- `backtestReportsBucket.grantRead(handler)` grants `s3:GetObject` + `s3:ListBucket`. The `ListObjectsV2` used in `deleteS3Prefix` requires `s3:ListBucket`. This is correctly covered.
- CLAUDE.md not updated with new `delete-account.ts` route file in the core domain.

### Dashboard Holdings Feature (get-balance rewrite)
- `BalanceResponse` in `src/domains/shared/types.ts` now has `totalValue: number` + `holdings: HoldingEntry[]` (replacing `available: number`). Any other consumer of `BalanceResponse` must be updated.
- `get-balance.ts` fetches balance + BTC price in parallel via `Promise.all`. Test mock order must match: first mockResolvedValueOnce = balance fetch, second = BTC price fetch. Confirmed correct.
- `ALLOCATION_COLORS` map in Dashboard.tsx uses hardcoded hex strings — violates webapp CLAUDE.md rule of using theme palette. Should reference `theme.palette` or shared `colors` tokens.
- Frontend local interface redefinition: `HoldingEntry` and `BalanceResponse` are duplicated in `Dashboard.tsx` instead of being imported from a shared types package. Acceptable for frontend/backend separation but worth noting.
- `balance!` non-null assertion on line 454 of Dashboard.tsx inside a conditional that already confirms `(balance?.holdings ?? []).length > 0` — the assertion is safe but the guard logic is slightly indirect; clean alternative is to use `balance?.holdings.map(...)` directly.
- `BOTS_TABLE_NAME` added to executor API handler environment (for `listBotTrades` ownership check) — needed and correct. IAM grant `grantReadData` added for `botsTable` on handler.
- `fetchBtcPrice` in `get-balance.ts`: no error handling if Binance returns non-OK response or non-numeric price string. `parseFloat` of a bad string returns `NaN`, which propagates silently into `btcValue` and `totalValue`.

### Bot Executor — Demo Exchange Integration (executeOnExchange)
- `DEMO_EXCHANGE_API_URL` is read at module level (`const DEMO_EXCHANGE_API_URL = process.env.DEMO_EXCHANGE_API_URL!`) — captured at import time. Tests in the first `describe` block that don't set this env var are safe only because those bots have no sizing config and `executeOnExchange` returns early. Always set `DEMO_EXCHANGE_API_URL` in every `beforeEach` that exercises exchange paths.
- `executeOnExchange` is called BEFORE `recordTrade` in both `once_and_wait` and `condition_cooldown` (cooldown) paths. In the no-cooldown branch, there is no conditional write guarding duplicate execution — concurrent invocations can place duplicate orders on the exchange while the DynamoDB-level deduplication (cooldown timestamp) is absent.
- `placeExchangeOrder` swallows non-ok HTTP errors (logs + continues) — intentional design so exchange failures don't block trade signal recording.
- `fetchDemoBalance` throws on non-ok HTTP — this propagates up through `calculateOrderSize` → `executeOnExchange` → bot-level catch, preventing `recordTrade` from being called. This is an intentional but undocumented design decision.
- `BotRecord` has no `exchange` field — bot-executor always calls the demo exchange regardless of which exchange the user configured in settings. This is correct for now (demo-only), but will need a guard when real exchange support is added.
- `condition_cooldown` mode is not tested at all in `bot-executor.test.ts` — neither the no-cooldown nor the with-cooldown path. Known gap.
- Lambda timeout is 30 seconds — correct for per-bot processing but tight if many bots with percentage sizing each trigger a balance fetch + order POST.

### Orderbook Domain (proxy pattern)
- All four routes extract `sub` from `event.requestContext.authorizer?.claims?.sub` (Cognito JWT claim) — correct auth pattern.
- `list-orders.ts` casts `Record<string, unknown>` fields with `as string`/`as number` — safe but brittle; prefer using `DemoOrderRecord` type imported from demo-exchange or a local mapped type.
- `get-balance.ts` checks `res.ok` AFTER calling `res.json()` — this risks a double-read on the response body stream. Read json first and check ok after is the correct order; but if the upstream returns a non-JSON error body, `.json()` may throw. Should guard with try/catch or check ok before parsing.
- `DEMO_EXCHANGE_API_URL` declared as module-level constant in every route file independently — shared env var reading is fine but the trailing slash in the URL string concatenation (`url` ends with trailing slash in env, then routes append path starting without slash) must be consistent. Tests confirm the URL is set to 'https://demo-api.example.com/' with trailing slash.
