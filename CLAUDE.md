# Blueplate

Telegram-first expense ingestion system that writes transactions to Lunch Money.
ARS amounts are converted to USD via the blue dollar rate at ingestion time.

## Tech Stack

- **Runtime**: Bun (native SQLite via `bun:sqlite`)
- **Telegram**: grammY
- **Lunch Money**: Custom typed fetch client (API v2)
- **FX**: DolarAPI.com (`/v1/dolares/blue` → `venta` field)
- **Validation**: zod
- **Storage**: SQLite
- **Testing**: `bun test`

## Commands

- `bun run start` — start bot
- `bun run dev` — start bot with watch mode
- `bun test` — run tests
- `bun run typecheck` — type check

## Architecture

- **Parser**: Pure functions, no side effects. Tokenizes free text into structured expense data.
- **FX**: DolarAPI client with TTL cache. Only converts ARS→USD.
- **LunchMoney**: Typed HTTP client for LM v2 API.
- **Storage**: SQLite for undo records, LM metadata cache, FX rate history.
- **Orchestrator**: Coordinates parse → resolve → enrich → write pipeline.
- **Bot**: grammY setup, commands, middleware. Depends only on Orchestrator.

## Lunch Money API v2

**IMPORTANT**: This project uses the Lunch Money **v2** API exclusively. Do NOT use v1.

- **Base URL**: `https://api.lunchmoney.dev/v2` (NOT `dev.lunchmoney.app/v1`, NOT `alpha.lunchmoney.dev/v2` which is a sandbox)
- **Docs**: https://alpha.lunchmoney.dev/v2/docs
- **Migration guide**: https://alpha.lunchmoney.dev/v2/migration-guide

### Key v2 differences from v1

- `/assets` → `/manual_accounts` (response key: `manual_accounts`)
- `asset_id` → `manual_account_id` on transactions
- `tags` (object array) → `tag_ids` (integer array)
- Status values: `cleared` → `reviewed`, `uncleared` → `unreviewed`
- POST returns **201** with full objects (not just IDs). Create response: `{ transactions: [...], skipped_duplicates: [...] }`
- DELETE returns **204 No Content** (not 200 with `true`)
- PUT sends payload directly (not wrapped in `{ transaction: ... }`)
- Categories default to nested format (groups have `children` array)
- Transaction objects are "dehydrated" — no hydrated category/asset names, only IDs
- The same API key works for both v1 and v2
- `alpha.lunchmoney.dev/v2` is a sandbox with demo data — do NOT use for prod
- `api.lunchmoney.dev/v2` is the real v2 endpoint that hits the user's actual budget

## Conventions

- CalVer versioning (YYYY.M.D)
- All config via env vars, validated with zod at startup
- Structured JSON logging
- `external_id = "bp_{chatId}_{messageId}"` for idempotency
- Metadata block appended to LM transaction notes: `[blueplate:v1]`
