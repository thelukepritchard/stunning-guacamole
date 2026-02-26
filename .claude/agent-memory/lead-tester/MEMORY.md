# Lead Tester Memory

## Project: stunning-guacomole

See `patterns.md` for detailed testing patterns.

### Quick Reference
- **Test command**: `cd src/domains && npm test -- --no-coverage` (runs all domain tests; `npm test` script simply calls `jest` with no extra flags so both `npm test` and `npx jest` work fine)
- **Filter by path**: use `--testPathPatterns="<pattern>"` (NOT `--testPathPattern` — that was renamed in Jest 30 and will error)
- **Test framework**: Jest (configured at `src/domains/jest.config.js`)
- **Test file pattern**: `<domain>/__tests__/*.test.ts` and `<domain>/__tests__/async/*.test.ts`
- **Shared test utility**: `src/domains/test-utils.ts` — `buildEvent()` has empty `requestContext: {}` (NO sub/authorizer by default)

### Known Patterns
1. Handler tests should mock route modules entirely (see trading handler pattern) — avoids DDB coupling
2. Route tests must mock BOTH `@aws-sdk/client-dynamodb` AND `@aws-sdk/lib-dynamodb` for any handler that uses DynamoDB
3. The `buildEvent()` utility has no `authorizer.claims` — always provide your own requestContext for auth-protected routes
4. `price-publisher` mocks must include DynamoDB in addition to SNS (handler writes price history to DDB)
5. Cognito trigger tests (pre-signup, post-confirmation) live in `<domain>/__tests__/async/` and mock both DDB packages
6. Cognito trigger event shapes: use `BaseTriggerEvent` fields (version, region, userPoolId, userName, triggerSource, callerContext, request, response). `PreSignUpTrigiterEvent` needs `response: { autoConfirmUser, autoVerifyEmail, autoVerifyPhone }`.
7. TypeScript TS7022 "implicitly has type any" in do-while loops: add an explicit type annotation to the awaited result variable (e.g. `const batchResult: ExpectedType = await ...`) to break circular inference.
8. **CRITICAL: Use `jest.resetAllMocks()` NOT `jest.clearAllMocks()` in `beforeEach`**. `clearAllMocks` only resets call counts — it does NOT clear the `mockResolvedValueOnce` queue. Leftover queued mock values from failing tests bleed into subsequent tests, causing mysterious 404s or wrong return values. `resetAllMocks` clears both call history AND the pending mock queue.
9. When a source file removes a DDB call (e.g. deletes a `GetCommand` pre-fetch), update ALL tests for that handler to remove the corresponding mock. The `mockResolvedValueOnce` queue is positional — every call must have exactly the right mock at the right position.
10. Route tests that mock `@aws-sdk/client-s3` must include `S3Client: jest.fn(() => ({ send: mockS3Send }))` and `DeleteObjectCommand: jest.fn((params) => ({ ...params, _type: 'DeleteObject' }))`. Add `mockS3Send` as a separate top-level jest.fn() alongside `mockSend` and `mockEventBridgeSend`.
11. For routes with sequential QueryCommands (e.g. GSI lookup then range query), queue exactly two `mockResolvedValueOnce` calls in order. Use `jest.requireMock('@aws-sdk/lib-dynamodb')` to introspect `QueryCommand.mock.calls[N][0]` and assert per-call params (IndexName, ExpressionAttributeValues, Limit, ScanIndexForward, etc.).
12. **CRITICAL: After `jest.resetAllMocks()`, DDB command constructors (PutCommand, QueryCommand, etc.) lose their `jest.fn((params) => ({ ...params }))` implementation.** This means `mockSend.mock.calls[N][0]` (the constructed instance) becomes `{}`. Always introspect the constructor params via `PutCommand.mock.calls[N][0]` (first arg to the constructor) instead. Obtain the mock constructor with `const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock }` after the `jest.mock()` calls.

13. **CRITICAL: `mockResolvedValue` and `mockImplementation` interaction.** After `resetAllMocks()`, calling `mockFn.mockResolvedValue({})` (sets base impl) and then later calling `mockFn.mockImplementation(fn)` in the test body does NOT reliably override the `mockResolvedValue` in Jest 30. Use `mockRejectedValue(err)` instead of `mockImplementation(() => Promise.reject(err))` for error propagation tests. Use `mockImplementation` with dispatch-by-type for multi-path testing — but set it BEFORE `mockResolvedValue`/`mockRejectedValue` calls, not after.
14. **CRITICAL: After `jest.resetAllMocks()`, command constructors (QueryCommand, DeleteCommand, AdminDisableUserCommand, etc.) lose their `jest.fn((params) => ({ ...params, _type }))` implementation and return `undefined`.** Restore them in `beforeEach` via `jest.requireMock(...).<Command>.mockImplementation((params) => ({ ...(params as object), _type: '...' }))`. Without this, `mockSend` receives `undefined` arguments and dispatch-by-type patterns break.
15. **Parallel DynamoDB execution breaks `mockResolvedValueOnce` ordering.** When a handler runs multiple DDB operations in `Promise.all`, all operations start simultaneously, and the `mockResolvedValueOnce` queue is consumed in microtask order (not source-code order). For pagination and table-specific tests, use `mockImplementation` with a stateful per-table counter or table-name dispatch instead of `mockResolvedValueOnce` chains.
16. **New AWS SDK packages must be added to `src/domains/package.json` dependencies.** The `@aws-sdk/client-cognito-identity-provider` package was missing and had to be installed (`npm install @aws-sdk/client-cognito-identity-provider` in `src/domains/`) before tests using it could compile.
17. **Stray closing brace bug in test files.** A misplaced `it(...)` outside its `describe(...)` block causes a TypeScript `TS1128: Declaration or statement expected` compile error on the orphaned `});`. Fix by moving the `it(...)` inside the correct `describe` block and removing the extraneous closing brace. This happened in `orderbook/__tests__/routes.test.ts` — the `returns 502 when demo exchange is unreachable` test was accidentally placed after `describe('getBalance')` was closed.

### Files Updated in Previous Sessions
- `portfolio/__tests__/handler.test.ts` — Converted to mock-based dispatch pattern; added getPortfolioPerformance + getLeaderboard routing tests
- `portfolio/__tests__/routes.test.ts` — Rewrote listPortfolios tests with DDB mock; added getPortfolioPerformance + getLeaderboard tests (using `username` not `email`)
- `trading/__tests__/price-publisher.test.ts` — Added missing DynamoDB mock (client-dynamodb + lib-dynamodb)
- `portfolio/__tests__/async/post-confirmation.test.ts` — Updated for `createDefaultBot` addition: now 9 tests covering happy path (2 DDB sends), idempotency early-return skips bot creation, unexpected error doesn't create bot, missing username throws without any DDB calls, conditional write expression, bot table/item structure, RSI buy/sell query rules, best-effort bot failure returns event, UUID uniqueness across invocations. Uses `PutCommand.mock.calls[N][0]` (constructor params) not `mockSend.mock.calls[N][0]` (instance) to survive `resetAllMocks`.
- `portfolio/__tests__/async/pre-signup.test.ts` — NEW: Tests for Cognito pre-signup trigger (username validation: presence, min/max length, character set, uniqueness GSI query)
- `trading/routes/delete-bot.ts` — Fixed TS7022 in do-while BatchWriteCommand loop by adding explicit type annotation to batchResult
- `trading/__tests__/routes.test.ts` — Fixed `deleteBot` backtest cleanup tests: removed erroneous `GetCommand` mock (source no longer pre-fetches bot before deletion); changed `jest.clearAllMocks()` to `jest.resetAllMocks()` in `beforeEach` to prevent mock queue bleed-over from failing tests contaminating subsequent tests.
- `portfolio/__tests__/routes.test.ts` — Added `getTraderProfile` describe block (12 tests: happy path 7d/24h/30d, null summary, undefined Items, 404 on missing user, 404 on undefined Items, 400 on missing username, 400 on invalid period, GSI param assertion, performance sub assertion).
- `portfolio/__tests__/handler.test.ts` — Added `GET /portfolio/leaderboard/{username}` dispatch test (mockGetTraderProfile mock + route assertion).
- `core/__tests__/routes.test.ts` — Complete rewrite: added `deleteAccount` describe block (19 tests) covering 401 auth checks, single-key DeleteCommands, composite-key QueryCommand+BatchWrite, GSI QueryCommand+BatchWrite, S3 listing+delete, pagination for composite/GSI/S3, Cognito disable+delete+ordering, DDB/Cognito error propagation. Also updated `submitFeedback` tests to use `jest.requireMock` constructor introspection and `resetAllMocks`.
- `core/__tests__/handler.test.ts` — Added mock for `deleteAccount` route + routing test for `DELETE /core/account`.
- `trading/__tests__/routes.test.ts` — Added `getPriceHistory` describe block (12 tests) covering: 200 with items, slash/dash/no-separator normalization (BTC/USDT, BTC-USDT, BTCUSDT, ETHUSDT, BNBBTC, ETH-USDT), default 24h period, DDB QueryCommand key expression + ScanIndexForward assertion, undefined Items coercion to [], 400 on missing pair, 400 on invalid period, 401 on missing sub. Uses inline `require('@aws-sdk/lib-dynamodb')` + `expect(QueryCommand).toHaveBeenCalledWith(expect.objectContaining(...))` pattern.
