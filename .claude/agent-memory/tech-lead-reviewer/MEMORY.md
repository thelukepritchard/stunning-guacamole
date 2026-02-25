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

### Domain Grant Patterns
- `botPerformanceTable` on `tradingApiHandler`: `grantReadWriteData` (needed for delete cleanup + read for GET performance)
- `tradesTable` on `tradingApiHandler`: `grantReadWriteData` (needed for delete cleanup + read for list trades)
- `priceHistoryTable` on `tradingApiHandler`: `grantReadData` (API only reads — no write routes)
- `botsTable` on `tradingApiHandler`: `grantReadWriteData` (CRUD)
- `settingsTable` on `tradingApiHandler`: `grantReadWriteData` (GET + PUT settings)

### Stack Architecture Notes
- `botPerformanceTable` is exposed as `public readonly` on `DomainTradingStack` and passed to `DomainPortfolioStack` for cross-domain reads.
- Trading domain: 5 Lambda functions — API handler, price publisher, bot executor, lifecycle handler, bot performance recorder.
- `botPerformanceTable` GSI `sub-index` is used by portfolio domain for user-level aggregation.
- Portfolio table lives in `AuthStack` (not `DomainPortfolioStack`) to avoid circular dependency with the post-confirmation trigger.
- `username-index` GSI on the portfolio table uses `ProjectionType.KEYS_ONLY` — pre-signup Lambda only needs to check existence, not read attributes.
- Pre-signup Lambda needs only `grantReadData` (Query GSI). Post-confirmation Lambda needs only `grantWriteData` (PutItem). Both are correctly scoped.

### Async Handler Testing Gaps
- There are no unit tests for `async/pre-signup.ts` or `async/post-confirmation.ts`. The project does not currently test Cognito trigger handlers. Flag as a coverage gap when reviewing.

### Infrastructure Test Gaps (Auth feature)
- When new Lambda functions are added to AuthStack (e.g. pre-signup trigger), `infrastructure/test/infrastructure.test.ts` must be updated to assert the new function. This was omitted for the pre-signup Lambda.

### Username Uniqueness Race Condition — Known Pattern
- Cognito pre-signup + GSI uniqueness check has an inherent TOCTOU race: two concurrent signups with the same username can both pass the GSI check before either writes to DynamoDB. The check is best-effort only; true uniqueness enforcement requires a conditional write or a dedicated lock table. Always document this caveat when reviewing this pattern.
