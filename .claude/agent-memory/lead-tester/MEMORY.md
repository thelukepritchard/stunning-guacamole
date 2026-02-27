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

18. **Async handler tests (SNS/ScheduledEvent) live in `<domain>/__tests__/` alongside route tests** (NOT in a separate `async/` subdirectory — the jest testMatch pattern is `**/__tests__/**/*.test.ts` which covers any depth, but the project convention is a flat `__tests__/` directory per domain). Name them after the source file, e.g. `bot-executor.test.ts`, `bot-performance-recorder.test.ts`.
19. **SNS handler test pattern**: Build a full `SNSEvent` with `Records[0].Sns.Message = JSON.stringify(indicators)` and `MessageAttributes: { pair: { Type: 'String', Value: pair } }`. Mock the `@aws-sdk/lib-dynamodb` GSI QueryCommand + GetCommand for bot lookup, then UpdateCommand (conditional write) + PutCommand (trade) + UpdateCommand (entryPrice). Once-and-wait buy fires if `lastAction` is undefined and `buyQuery` matches.
20. **ScheduledEvent handler test pattern** (bot-performance-recorder): DDB call order for single bot is: ScanCommand (active bots) → QueryCommand (price history) → QueryCommand (trades) → PutCommand (snapshot). For single-bot tests `mockResolvedValueOnce` chains are safe because order is deterministic. For multi-bot pagination tests use `mockResolvedValue` fallbacks after the queued calls.
21. **`isAllowedOnceAndWait` behaviour** (post-fix): when `lastAction` is `undefined` (fresh bot), only `buy` is allowed — `sell` is always blocked. When `lastAction` is set, only the counter-action is allowed. Tests for this live in `executor/__tests__/bot-executor.test.ts`.
22. **`calculatePnl` realisedPnl guard** (post-fix): `realisedPnl = 0` when `totalBuys === 0`, even if `totalSells > 0`. Previously `avgBuyCost` of 0 made sells look like pure profit. Tests live in `analytics/__tests__/bot-performance-recorder.test.ts`.

23. **Mocking `global.fetch` in Node test environment**: Use `jest.spyOn(global, 'fetch')` in `beforeEach` and `mockFetch.mockRestore()` in `afterEach`. Node 24 has native fetch — no polyfill needed. Return a cast `as Response` object with `{ ok, json, text, status }` fields. For ordered multi-call sequences use `mockResolvedValueOnce` chains (first GET balance, then POST order). Set `process.env.DEMO_EXCHANGE_API_URL` in `beforeEach` — it is a module-level const so the value at module-load time becomes the URL prefix; mock fetch intercepts all calls regardless.
24. **`executeOnExchange` test patterns**: Fixed sizing → 1 fetch call (POST order only). Percentage sizing → 2 fetch calls (GET balance, then POST order). Zero balance → 1 fetch call (GET balance), order skipped but trade still recorded. Exchange POST non-ok → trade still recorded (placeExchangeOrder swallows errors). Balance GET non-ok → throws inside bot-level catch, trade NOT recorded.

### Key Test Files
- `executor/__tests__/bot-executor.test.ts` — SNS handler: 18 tests (isAllowedOnceAndWait, executeOnExchange/sizing/fetch paths, error resilience)
- `analytics/__tests__/bot-performance-recorder.test.ts` — ScheduledEvent handler: 11 tests (calculatePnl variants, snapshot structure, pagination, error resilience)
