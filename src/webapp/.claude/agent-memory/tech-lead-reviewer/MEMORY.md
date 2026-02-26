# Tech Lead Reviewer — Webapp Memory

## Webapp Conventions (Confirmed)

### Styling
- All colours MUST reference `theme.palette.*` (via `useTheme()`) or shared design tokens (`@shared/styles/tokens`)
- No hardcoded hex colour values in component files
- MUI `sx` prop is the sole styling mechanism — no inline `style=` or CSS modules
- Monospace text: `sx={{ fontFamily: typography.fontFamily.mono }}` (import `typography` from `@shared/styles/tokens`)

### Component Standards
- All exported functions and internal helpers must have JSDoc comments
- Props interfaces must be defined above the component function
- Internal helper functions (e.g. `useTrendInfo`) go above the component they serve
- Module-level constants should have JSDoc line comments (`/** ... */`)

### API Calls
- Always use `useApi()` hook — never raw `fetch` in components
- Errors from `request<T>()` must be `instanceof Error` checked before `.message` access
- Non-critical fetch failures (sparklines, supplemental data) may swallow errors with a comment explaining why

### Polling Pattern
- Use `useRef<ReturnType<typeof setInterval> | null>` for interval references
- Always clear intervals in `useEffect` cleanup functions
- Clear interval in the callback itself when terminal state is reached

### Route Structure
- `/bots/view/:botId` — BotView (individual bot detail + backtesting)
- `/bots/:pair` — BotDetail (pair-level view)
- These are sibling routes in App.tsx — order matters (specific before wildcard)

### API Endpoints (Backtesting)
- `GET /trading/bots/{botId}/backtests` — list all (max 5), newest first, no report payload
- `POST /trading/bots/{botId}/backtests` — submit, returns 202 with `{ backtestId, status }`
- `GET /trading/bots/{botId}/backtests/latest` — lightweight polling endpoint, includes summary on completion
- `GET /trading/bots/{botId}/backtests/{backtestId}` — full report from S3 proxy

### `listBacktests` API response
Returns a raw array (not wrapped in `{ items: [...] }`). Confirmed from `list-backtests.ts` route.

### `getLatestBacktest` API response
Returns 404 when no backtests exist (not an empty object). Frontend must handle this.
