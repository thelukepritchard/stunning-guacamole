# Tech Lead Reviewer Memory

## Project: Signalr (stunning-guacomole)

### Key Patterns Confirmed

**JSDoc requirement**: ALL functions (including private helpers) must have JSDoc. This is mandatory per CLAUDE.md.

**Lambda handler pattern**: Step Functions handlers do NOT follow `APIGatewayProxyEvent` pattern — they receive typed input objects directly and return plain objects. They still need JSDoc.

**DynamoDB key patterns**:
- bots table: `{ sub, botId }` (partition: sub, sort: botId)
- trades table: `{ botId, timestamp }` (partition: botId, sort: timestamp)
- backtests table: `{ sub, backtestId }` (partition: sub, sort: backtestId)
- backtests GSI: `botId-index` — partition: botId, sort: testedAt

**S3 Body access**: `s3Result.Body!.transformToString()` — the non-null assertion is required because AWS SDK types Body as `Readable | undefined`. Pattern used in get-backtest.ts and get-latest-backtest.ts. Both rely on the S3 key being present (gated behind `metadata.s3Key` check).

**Validation helper duplication**: `validateSizing`, `validateStopLoss`, `validateTakeProfit` are duplicated between `create-bot.ts` and `update-bot.ts`. This is an existing pattern — worth noting but not blocking.

**EventBridge bus**: Default event bus used. `arn:aws:events:${region}:${account}:event-bus/default`

**Lambda memory**: All Lambdas must use `memorySize: 256`.

**Naming convention**: `${name}-${environment}-${description}` for all resources.

**Domain tag**: `cdk.Tags.of(this).add('Domain', 'trading')` at top of constructor.

**Step Functions**: Uses `outputPath: '$.Payload'` on LambdaInvoke tasks. Failure handler reads from `$$.Execution.Input` for backtestId/sub.

**Handler test pattern**: handler.test.ts mocks all route modules and tests dispatch only. routes.test.ts tests route handlers with mocked AWS SDK.

**crypto import**: `create-bot.ts` uses `from 'node:crypto'`. `submit-backtest.ts` uses `from 'crypto'` — inconsistency but minor.

### Infrastructure CLAUDE.md notes
- Test file expected at `test/infrastructure.test.ts` — currently absent (pre-existing gap, not introduced by backtesting).
- `infrastructure/CLAUDE.md` says "Add a test asserting the Lambda is created" for new domain stacks.
