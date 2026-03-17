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

## Conventions

- CalVer versioning (YYYY.M.D)
- All config via env vars, validated with zod at startup
- Structured JSON logging
- `external_id = "bp_{chatId}_{messageId}"` for idempotency
- Metadata block appended to LM transaction notes: `[blueplate:v1]`
