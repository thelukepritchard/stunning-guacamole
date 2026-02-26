# Notion Context Retriever — Memory

## Signalr Workspace Root
Page ID: `3115ae86-48e7-8108-82bd-f15d8aa48ef7`
URL: https://www.notion.so/3115ae8648e7810882bdf15d8aa48ef7

## Page Hierarchy

### Top-Level Children of Root
- Features: `3125ae86-48e7-81a6-93b1-f27f061f273a`
- Product Specs: `3115ae86-48e7-81e3-bffd-c973f8c10490`
- Pricing & Tiers: `3115ae86-48e7-81e5-ba28-c86a9f20a7ba`
- Architecture & Domains: `3115ae86-48e7-810c-8750-dea42d0117ce`
- To-Do & Known Issues: `3115ae86-48e7-8104-a6d7-e66b58a59774`
- Design System: `3125ae86-48e7-816c-be37-f3c0c894c641`

### Features (under 3125ae86-48e7-81a6-93b1-f27f061f273a)
- Bot Configuration: `3115ae86-48e7-819b-b327-ca5854220443`
- Exchange Configuration: `3115ae86-48e7-81d8-9600-ea5f2e0b5468`
- Leaderboard & Copy Trading: `3115ae86-48e7-8143-bc4a-e15c3d808add`
- Backtesting: `3125ae86-48e7-81c5-b49b-ed0e379ea30c`

### Architecture & Domains (under 3115ae86-48e7-810c-8750-dea42d0117ce)
- Trading Domain: `3115ae86-48e7-8181-9a24-c229d1b7f941`
- Portfolio Domain: `3115ae86-48e7-81f4-b80e-df65aaca07ef`
- Orderbook Domain: `3115ae86-48e7-819a-9b37-ef4f5e5c6c9c`
- Core Domain: `3115ae86-48e7-81ad-b387-c240d807c2e3`
- Demo Exchange Domain: `3135ae86-48e7-8132-9c40-d7411d28f367`
- Billing Domain: `3115ae86-48e7-816c-82cb-f71ad5380273`

### Portfolio Domain children
- Leaderboard (Portfolio Subdomain): `3115ae86-48e7-814f-ab10-f468d4c1f901`

### Product Specs children
- Overview & Target Audience: `3115ae86-48e7-81fe-ba15-d60b41a086e8`

## Key Documentation Notes
- No dedicated "Dashboard" or "Home" page spec exists in the Signalr workspace
- The "Home views" database (9e4adc80) is unrelated — belongs to a different Notion parent
- Demo mode is the default for all new users: `exchange: 'demo'`, `baseCurrency: 'USD'`
- Demo balance seeded at $1,000 USD on first interaction
- Portfolio performance endpoint: GET /portfolio/performance?period=24h|7d|30d|all
- Trading settings GET returns demo defaults when no record exists (never 404)
- Monospace font used for all P&L / financial numeric data
- P&L colours: success.main (#34d399) positive, error.main (#f87171) negative
