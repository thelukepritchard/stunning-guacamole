# Lead Tester Memory

## Project: stunning-guacomole

See `patterns.md` for detailed testing patterns.

### Quick Reference
- **Test command**: `cd src/domains && npx jest` (runs all domain tests; `npm test` script passes `--testPathPattern` which is rejected by the Jest version installed — use `npx jest --testPathPatterns="<filter>"` to run a subset)
- **Test framework**: Jest (configured at `src/domains/jest.config.js`)
- **Test file pattern**: `<domain>/__tests__/*.test.ts` and `<domain>/__tests__/async/*.test.ts`
- **Shared test utility**: `src/domains/test-utils.ts` — `buildEvent()` has empty `requestContext: {}` (NO sub/authorizer by default)

### Known Patterns
1. Handler tests should mock route modules entirely (see trading handler pattern) — avoids DDB coupling
2. Route tests must mock BOTH `@aws-sdk/client-dynamodb` AND `@aws-sdk/lib-dynamodb` for any handler that uses DynamoDB
3. The `buildEvent()` utility has no `authorizer.claims` — always provide your own requestContext for auth-protected routes
4. `price-publisher` mocks must include DynamoDB in addition to SNS (handler writes price history to DDB)
5. Cognito trigger tests (pre-signup, post-confirmation) live in `<domain>/__tests__/async/` and mock both DDB packages
6. Cognito trigger event shapes: use `BaseTriggerEvent` fields (version, region, userPoolId, userName, triggerSource, callerContext, request, response). `PreSignUpTriggerEvent` needs `response: { autoConfirmUser, autoVerifyEmail, autoVerifyPhone }`.
7. TypeScript TS7022 "implicitly has type any" in do-while loops: add an explicit type annotation to the awaited result variable (e.g. `const batchResult: ExpectedType = await ...`) to break circular inference.

### Files Updated in Previous Sessions
- `portfolio/__tests__/handler.test.ts` — Converted to mock-based dispatch pattern; added getPortfolioPerformance + getLeaderboard routing tests
- `portfolio/__tests__/routes.test.ts` — Rewrote listPortfolios tests with DDB mock; added getPortfolioPerformance + getLeaderboard tests (using `username` not `email`)
- `trading/__tests__/price-publisher.test.ts` — Added missing DynamoDB mock (client-dynamodb + lib-dynamodb)
- `portfolio/__tests__/async/post-confirmation.test.ts` — Tests for Cognito post-confirmation trigger (happy path, idempotency, error propagation, throws on missing preferred_username, conditional write params). "throws on missing preferred_username" test was corrected when handler was tightened to reject absent username rather than write empty string.
- `portfolio/__tests__/async/pre-signup.test.ts` — NEW: Tests for Cognito pre-signup trigger (username validation: presence, min/max length, character set, uniqueness GSI query)
- `trading/routes/delete-bot.ts` — Fixed TS7022 in do-while BatchWriteCommand loop by adding explicit type annotation to batchResult
