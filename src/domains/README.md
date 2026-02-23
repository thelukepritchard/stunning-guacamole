# Domains

Here is all the backend code using a domain-driven design

It is referenced by the Lambda configuration found in `infasturcture`

## Structure

Each domain follows this layout:

```
src/domains/<name>/
  index.ts       — Lambda entry-point, routing logic
  utils.ts       — Shared helpers (jsonResponse) and route handler types
  routes/
    <route>.ts   — One file per route handler
```

## Routing

Each `index.ts` dispatches requests using a `switch` on the route key:

```ts
const routeKey = `${event.httpMethod} ${event.resource}`;

switch (routeKey) {
  case 'GET /<name>':         return listItems(event);
  case 'POST /<name>':        return createItem(event);
  case 'GET /<name>/{id}':    return getItem(event);
  case 'PUT /<name>/{id}':    return updateItem(event);
  case 'DELETE /<name>/{id}': return deleteItem(event);
  default:
    return { statusCode: 404, body: JSON.stringify({ error: 'Route not found' }) };
}
```

- `event.resource` is the API Gateway resource path template (e.g. `/portfolio/{id}`), not the actual request path.
- Route handlers receive the raw event and extract parameters via `event.pathParameters` (e.g. `event.pathParameters?.id`).
- Each route handler lives in its own file under `routes/` and is imported by `index.ts`.

## Testing

Tests use Jest with ts-jest and live alongside source code in `__tests__/` directories:

```
src/domains/<name>/__tests__/
  handler.test.ts   — Route dispatch tests for the Lambda entry point
  utils.test.ts     — jsonResponse helper tests
  routes.test.ts    — Individual route handler tests
```

A shared `buildEvent()` mock factory is in `test-utils.ts`.

```bash
# Run all domain tests
npm test
```