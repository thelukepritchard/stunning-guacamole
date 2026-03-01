# Signalr — Pre-Production Roadmap

## Phase 0 — Production Foundation (Current)
> Make what's built actually work end-to-end.

- [x] Wire real order placement — Executor calls exchange adapters to place actual market orders
- [x] Route users to real exchanges — Connect Swyftx/CoinSpot adapters into exchange proxy based on user settings
- [x] Switch market data source from Binance to Kraken BTC/AUD — All prices/indicators in AUD for Australian audience
- [x] Secure demo exchange API — IAM auth + SigV4 signed requests from exchange handler and bot executor
- [ ] ~~Rename `techniverse` → `signalr` across all AWS resources~~ — Deferred

## Phase 1 — Minimum Lovable Product (Launch)
> Ship with one strong on-ramp: manual builder with templates.

- [ ] **Bot templates (5-8 strategies)** — Pre-built configs for common strategies: RSI oversold bounce, MACD crossover, Bollinger Band squeeze, momentum breakout, mean reversion, etc. Default flow: pick template → review → tweak → deploy.
- [ ] **Backtesting frontend** — Backend is complete. Build the UI: submit button, polling state, report display (summary cards, price chart with trade markers, hourly log, backtest history).
- [ ] **Email notifications** — Trade executed, SL/TP triggered, backtest complete, order failed. SES or SNS email integration.
- [ ] **Billing (Stripe) — Free + Pro tiers** — Stripe Checkout, Customer Portal, webhook handler, subscription table. Gate backtesting and extra exchanges behind Pro ($19/mo). Skip Elite tier for now.
- [ ] **Leaderboard fix (% return ranking)** — Switch from absolute 24h P&L to percentage return. Already tracked as to-do in Notion.
- [ ] **Alert-only bot mode** — New execution mode that sends notifications but doesn't place orders. Zero-risk entry for cautious users.

## Phase 2 — Copy Trading (Simplified)
> Second on-ramp: social trading via bot cloning.

- [ ] **Copy Bot (config clone)** — One-time copy of another trader's bot rules as a new draft bot. No live mirroring, no proportional sizing. Already spec'd in Notion.
- [ ] **Leaderboard opt-out** — Allow users to remove themselves from rankings. Auto-pause any future mirror subscriptions.
- [ ] **Trader profile enhancement** — Show bot list (names/pairs only, no rule configs), trade history, win rates, performance charts.

## Phase 3 — AI Bot Builder
> Third on-ramp: natural language strategy creation.

- [ ] **AI Chat Bot Builder (Bedrock)** — Embedded chat window in bot creation flow. "I want to buy BTC when it's oversold" → AI generates rule config using existing indicator/rule structure. Multi-turn conversation for refinement.
- [ ] **AI usage tracking** — Per-tier monthly caps (Free=5/mo, Pro=20/mo, Elite=unlimited — TBD). Usage table + enforcement.
- [ ] **Review & edit generated rules** — Users must review AI output before saving. Generated config maps to standard rule structure.

## Phase 4 — Growth Features
> Differentiation and expansion.

- [ ] Full portfolio mirroring (copy trading v2) — Live-mirror a trader's entire bot portfolio with proportional position sizing
- [ ] Mirror kickback programme — Traders earn 20% of copier's subscription fee as credit
- [ ] Trailing stop-loss — Adjusts upward as price moves favourably, locks in profit
- [ ] Limit orders — User-defined entry/exit prices (adapter extension needed)
- [ ] More indicators — ATR, Stochastic RSI, VWAP, OBV
- [ ] Multi-timeframe analysis — Support 5m, 15m, 1h, 4h, 1d timeframes for indicator calculation
- [ ] Binance + Kraken Pro adapters — Phase 2 exchange integrations
- [ ] Elite tier + AI trade analysis — AI-powered performance insights (Bedrock)
- [ ] Paper trading on real exchanges — Simulated balances against real market data across all pairs
- [ ] Bot performance comparison — Side-by-side comparison of multiple bots
- [ ] Scheduled bot activation — Time-based rules ("run only during Asian trading hours")
- [ ] Onboarding wizard — Step-by-step flow for first-time users
- [ ] Activity feed / audit log — Chronological feed of all bot and account activity
