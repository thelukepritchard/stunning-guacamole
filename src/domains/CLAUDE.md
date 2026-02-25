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

## Adding a New Domain Handler

1. Create `<name>/` with `index.ts`, `utils.ts`, and `routes/` following existing patterns.
2. Add tests in `<name>/__tests__/` (handler, utils, routes).
3. Wire the corresponding infrastructure stack — see `infrastructure/CLAUDE.md`.
