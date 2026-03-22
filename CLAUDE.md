# Blueplate

Telegram-first expense ingestion for Lunch Money. ARS → USD via blue dollar compra rate.

## Commands

```bash
bun run start        # start bot
bun run dev          # start bot with watch mode
bun test             # run tests
bun run typecheck    # type check
```

## Tech Stack

- **Runtime**: Bun (native SQLite via `bun:sqlite`)
- **Telegram**: grammY
- **Lunch Money**: Custom typed fetch client (v2 API only)
- **FX**: DolarAPI.com (live) + ArgentinaDatos (historical) → compra rate
- **PDF**: unpdf (extraction) + gpt-4o-mini (structuring)
- **Validation**: zod
- **Testing**: `bun test`

## Boundaries

- Lunch Money API is **v2 only**. Never use v1. See `docs/lunchmoney-v2.md`.
- FX conversion uses the **compra** (buy) rate, not venta. You sell USD to cover ARS expenses.
- `external_id` patterns: `bp_{chatId}_{msgId}` (manual), `bp_import_{chatId}_{msgId}_{i}` (PDF import).
- All config via env vars, validated with zod at startup (`src/config.ts`).
- Single-user bot — no multi-tenancy considerations.

## Conventions

- CalVer versioning (YYYY.M.D)
- Structured JSON logging
- `status: "reviewed"` for manual entries, `"unreviewed"` for PDF imports
- Metadata stored as `custom_metadata` on LM transactions (BlueplateMetadata schema)
