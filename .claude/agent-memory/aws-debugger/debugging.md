# Debugging Notes

## 2026-02-27 — Analytics 502 Investigation

### What Was Checked
1. All 3 analytics Lambda functions: handler, bot-perf-recorder, portfolio-perf-recorder
2. CloudWatch Logs Insights queries across 7-day window for ERROR, Exception, Timeout, ValidationException, etc.
3. All 5 most recent log streams for analytics-handler
4. Lambda function configurations (env vars, timeout, runtime)
5. DynamoDB table schemas and sample data
6. API Gateway execution logging status
7. All analytics route handler source code

### Findings
- **No errors in Lambda logs** — analytics-handler has zero application-level log output (no console.log calls in route handlers either). Only START/END/REPORT lines.
- **Bot-perf-recorder is healthy** — logs show "Computing performance for 1 active bots" and "Recorded performance snapshots for 1 bots" on every 5-min run.
- **Both performance tables have 167 items** — data is being written correctly.
- **Analytics handler timeout is only 3 seconds** — cold start + DynamoDB calls take 550-631ms currently. Safe now but risky as data grows.
- **No top-level try/catch** in any domain handler (this is consistent across all domains by design, but means any unhandled DDB exception becomes a Lambda error → 502).
- **API Gateway execution logging is disabled** — cannot correlate which specific API requests got 502s.

### Potential Root Causes for 502
1. **Unhandled DynamoDB exception** — If a DynamoDB call throws (e.g., transient network error, throttling, malformed request) and no try/catch catches it, Lambda returns an error response and API Gateway converts to 502. The Lambda logs would show nothing beyond START/END since the error is an unhandled promise rejection at the Node.js level that doesn't always write to CloudWatch before the function terminates.
2. **Leaderboard route timeout risk** — `getLeaderboard` does a full table scan of all portfolio users then fires N parallel DynamoDB queries. With current 1-user dataset this is fast, but with growth this will exceed the 3-second timeout.
3. **Route not found (404 misidentified as 502)** — If the frontend is calling a URL that doesn't match the switch cases in index.ts, the default returns 404, not 502. Unlikely to be the cause.

### Code Issues Found
- `src/domains/analytics/index.ts` — No top-level try/catch. All route handlers lack error wrapping.
- `src/domains/analytics/async/bot-performance-recorder.ts` — Individual bot processing has try/catch (line 164), but the outer scan and price lookup code is unprotected.
- `infrastructure/lib/domain-analytics.ts` — Analytics handler timeout is 3s (line: not explicitly set, uses Lambda default of 3s). Should be increased given it makes multiple DDB calls.

### Recommendations
1. Add a top-level try/catch in `src/domains/analytics/index.ts` handler wrapping the entire switch dispatch, returning jsonResponse(500, ...) on error with console.error logging.
2. Increase analytics handler Lambda timeout to at least 10-15 seconds in `infrastructure/lib/domain-analytics.ts`.
3. Enable API Gateway execution logging on the prod stage to capture future 502 correlation.
4. Add console.log instrumentation to route handlers for request tracing.
