# Notion Docs Updater — Memory

## Key Notion Page IDs

| Page Title | Page ID | URL |
|---|---|---|
| 🚀 Signalr (root) | 3115ae86-48e7-8108-82bd-f15d8aa48ef7 | https://www.notion.so/3115ae8648e7810882bdf15d8aa48ef7 |
| 🏗️ Architecture & Domains | 3115ae86-48e7-810c-8750-dea42d0117ce | https://www.notion.so/3115ae8648e7810c8750dea42d0117ce |
| 🤖 Trading Domain | 3115ae86-48e7-8181-9a24-c229d1b7f941 | https://www.notion.so/3115ae8648e781819a24c229d1b7f941 |
| 📈 Portfolio Domain | 3115ae86-48e7-81f4-b80e-df65aaca07ef | https://www.notion.so/3115ae8648e781f4b80edf65aaca07ef |
| 📒 Orderbook Domain | 3115ae86-48e7-819a-9b37-ef4f5e5c6c9c | https://www.notion.so/3115ae8648e7819a9b37ef4f5e5c6c9c |
| ⚙️ Core Domain | 3115ae86-48e7-81ad-b387-c240d807c2e3 | https://www.notion.so/3115ae8648e781adb387c240d807c2e3 |
| 💰 Billing Domain | 3115ae86-48e7-816c-82cb-f71ad5380273 | https://www.notion.so/3115ae8648e7816c82cbf71ad5380273 |
| 💰 Pricing & Tiers | 3115ae86-48e7-81e5-ba28-c86a9f20a7ba | https://www.notion.so/3115ae8648e781e5ba28c86a9f20a7ba |
| 🏆 Leaderboard & Copy Trading | 3115ae86-48e7-8143-bc4a-e15c3d808add | https://www.notion.so/3115ae8648e78143bc4ae15c3d808add |
| ✅ To-Do & Known Issues | 3115ae86-48e7-8104-a6d7-e66b58a59774 | https://www.notion.so/3115ae8648e78104a6d7e66b58a59774 |
| 🧩 Features | 3125ae86-48e7-81a6-93b1-f27f061f273a | https://www.notion.so/3125ae8648e781a693b1f27f061f273a |
| 🧪 Backtesting | 3125ae86-48e7-81c5-b49b-ed0e379ea30c | https://www.notion.so/3125ae8648e781c5b49bed0e379ea30c |

## Workspace Structure

- Root: "🚀 Signalr (No-code Bot Trading Service)"
- Domain docs live under: 🏗️ Architecture & Domains
- Feature docs live under: 🧩 Features

## Tool Usage Notes

- Use `mcp__claude_ai_Notion__*` tools (NOT `mcp__notion__*` — those have expired tokens)
- Always fetch a page before updating it to get exact content for `selection_with_ellipsis`
- `replace_content_range` selection must match the rendered Markdown text exactly
- Table rows in Notion markdown use `<tr>/<td>` format with `<table header-row="true">`
- Checkboxes: `- [ ]` = open, `- [x]` = done

## Trading Domain Page Structure (3115ae86-48e7-8181-9a24-c229d1b7f941)

Sections in order:
1. Trading Settings (Exchange, Base Currency)
2. DynamoDB Tables
3. REST Endpoints (main table with Status column)
4. Backtesting (subsections: How Engine Works, Artificial Delay, S3 Storage, DynamoDB schema, Config Change Invalidation, Bot Deletion, REST Endpoints, To-Do)
5. General To-Do

## Backtesting Page Structure (3125ae86-48e7-81c5-b49b-ed0e379ea30c)

Parent: 🧩 Features
Sections: Overview, User Experience, Tier Access, Constraints & Edge Cases, Artificial Delay Rationale, Implementation Status, Open Decisions
Cross-reference: "For technical details see 🤖 Trading Domain page"

## Backtesting Implementation Status (as of 2026-02-26)

IMPLEMENTED: Step Functions workflow, S3 bucket, submitBacktest, RunBacktest, WriteReport, listBacktests, getLatestBacktest, getBacktest, updateBot configChangedSinceTest, deleteBot S3 cleanup, price history ≥7 days validation

NOT YET IMPLEMENTED: Tier gating (needs billing domain), notification handler, frontend UI
OPEN QUESTIONS: Missing candle behaviour (currently skips), "compared to previous run" delta, sidebar vs tabs layout
