# Lead Tester Memory

## Project: stunning-guacomole

See `patterns.md` for detailed testing patterns.

### Quick Reference
- **Test command**: `cd src/domains && npm test` (runs all domain tests via Jest)
- **Test framework**: Jest (configured at `src/domains/jest.config.js`)
- **Test file pattern**: `<domain>/__tests__/*.test.ts`
- **Shared test utility**: `src/domains/test-utils.ts` — `buildEvent()` has empty `requestContext: {}` (NO sub/authorizer by default)

### Known Patterns
1. Handler tests should mock route modules entirely (see trading handler pattern) — avoids DDB coupling
2. Route tests must mock BOTH `@aws-sdk/client-dynamodb` AND `@aws-sdk/lib-dynamodb` for any handler that uses DynamoDB
3. The `buildEvent()` utility has no `authorizer.claims` — always provide your own requestContext for auth-protected routes
4. `price-publisher` mocks must include DynamoDB in addition to SNS (handler writes price history to DDB)

### Files Updated This Session
- `portfolio/__tests__/handler.test.ts` — Converted to mock-based dispatch pattern; added getPortfolioPerformance + getLeaderboard routing tests
- `portfolio/__tests__/routes.test.ts` — Rewrote listPortfolios tests with DDB mock; added getPortfolioPerformance + getLeaderboard tests
- `trading/__tests__/price-publisher.test.ts` — Added missing DynamoDB mock (client-dynamodb + lib-dynamodb)
