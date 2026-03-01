# Lead Tester Agent Memory

## Test Commands

- Run all domain tests: `npx jest` (from `/Users/lukepritchard/Documents/stunning-guacomole/src/domains/`)
- Run a subset: `npx jest --testPathPatterns=<pattern>` (note: `--testPathPattern` without the 's' is deprecated)
- Example: `npx jest --testPathPatterns="market|exchange|executor|shared"`

## Test Framework

- Jest with TypeScript (ts-jest)
- Test files live in `<domain>/__tests__/` directories
- Naming convention: `handler.test.ts`, `routes.test.ts`, `<async-handler>.test.ts`, `utils.test.ts`
- Shared test helper: `test-utils.ts` — exports `buildEvent` mock factory

## Mock Patterns

### AWS SDK mocking
```ts
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockSend }) },
  QueryCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Query' })),
  // etc.
}));
```

### sigv4Fetch mocking (used by demo exchange calls from executor + exchange routes)
```ts
const mockSigv4Fetch = jest.fn();
jest.mock('../../shared/sigv4-fetch', () => ({
  sigv4Fetch: (...args: unknown[]) => mockSigv4Fetch(...args),
}));
```
All calls to `fetch` that go through the demo exchange internally use `sigv4Fetch`. Tests must mock THIS, not global `fetch`.

## Known Gotcha: mockFetch vs mockSigv4Fetch
After the Kraken migration + IAM auth addition, `fetch` calls to the demo exchange were replaced with `sigv4Fetch`. Any test file that previously used `mockFetch` for demo exchange calls must be updated to use `mockSigv4Fetch`. The TypeScript compiler will catch lingering `mockFetch` references as `TS2304: Cannot find name 'mockFetch'`.

## Demo Exchange Response Shape (AUD, not USD)
After the USD->AUD migration the balance field is `aud`, not `usd`:
```ts
mockSigv4Fetch.mockResolvedValue({
  ok: true,
  json: async () => ({ aud: 10000 }),
} as Response);
```

## Kraken API Response Shapes (market domain)
- Ticker: `{ error: [], result: { XBTAUD: { c: ['50000'] } } }`
- OHLC: `{ error: [], result: { XBTAUD: [ [timestamp, open, high, low, close, vwap, volume, count] ] } }`

## Console Output in Tests
`console.log` and `console.error` emitted during tests that exercise error/edge-case paths are expected and do not indicate failures. They originate from the production handler code (e.g., malformed JSON SNS records, unknown execution modes, downstream 5xx responses).
