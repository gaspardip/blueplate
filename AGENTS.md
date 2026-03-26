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

## Architecture

```
src/
├── bot/           # Telegram handlers, formatters, middleware
├── parser/        # Text → structured expense (tokenizer, grammar, corrections)
├── orchestrator.ts # Pipeline: parse → resolve → FX → create in LM → save undo record
├── pdf/           # PDF import: extract text (unpdf) → structure (gpt-4o-mini)
├── lunchmoney/    # LM v2 API client, mapper, types
├── fx/            # Blue dollar FX: DolarAPI (live), ArgentinaDatos (historical)
├── storage/       # SQLite: undo records, caches, FX history, templates, aliases
├── config.ts      # Env var schema (zod)
├── tagger.ts      # Category → tag inference rules
├── payee.ts       # Payee normalization with Levenshtein fuzzy matching
├── digest.ts      # Daily/weekly summary scheduler
├── server.ts      # Hono HTTP: webhook endpoint + REST API
└── index.ts       # Entrypoint: init all services, start bot + server
```

## Data Flow

```
Manual:  text/voice → parse → resolve category/asset/tags → FX convert → LM create → save undo
Import:  PDF → extract text → LLM structure → preview → confirm → per-date FX → LM batch create
```

## Key Docs

| Doc | What it covers |
|-----|---------------|
| `docs/lunchmoney-v2.md` | v2 API contract: endpoints, request/response shapes, migration gotchas |
| `docs/fx.md` | FX conversion logic: compra rate, historical lookup, hydration script |
| `docs/pdf-import.md` | PDF import pipeline: extraction, LLM prompt, dedup, UX flow |
| `docs/parser.md` | Parser internals: tokenizer, grammar, category aliases, account splits |

## Invariants

- **No v1 API calls.** LM base URL is `https://api.lunchmoney.dev/v2`. Always.
- **Compra rate.** FX uses blue dollar compra (buy), never venta (sell).
- **Idempotent writes.** Every LM transaction has a unique `external_id`. Dedup on re-process.
- **Undo via split_group_id.** Multi-leg operations (imports, account splits) share a group ID. Undo deletes all legs.
- **PDF import dedup.** Skip imported transactions where a manual entry with same amount + date exists.
- **Historical FX per transaction.** PDF imports use the rate from each transaction's date, not today's rate.
- Single-user bot — no multi-tenancy considerations.

## Conventions

- CalVer versioning (YYYY.M.D)
- Structured JSON logging
- `external_id` patterns: `bp_{chatId}_{msgId}` (manual), `bp_import_{chatId}_{msgId}_{i}` (PDF import), `bp_sell_{chatId}_{msgId}_{0|1}` (FX sell)
- `status: "reviewed"` for manual entries, `"unreviewed"` for PDF imports
- Metadata stored as `custom_metadata` on LM transactions (BlueplateMetadata schema)
- All config via env vars, validated with zod at startup (`src/config.ts`)

## Testing

```bash
bun test                          # all tests
bun test test/orchestrator.test.ts # specific file
bun run typecheck                 # type check
```

Mock pattern: stub `globalThis.fetch` for DolarAPI, LM API, and OpenAI. See `test/orchestrator.test.ts` for examples.

## Deployment

- Hetzner CAX21, Coolify Cloud, webhook mode
- Persistent volume at `/app/data` (SQLite DB)
- `TZ=America/Argentina/Buenos_Aires` on the container
- Deploy via Coolify MCP: `mcp__coolify-mcp__deploy` with UUID `yw400oo4w4cg4ow84cw84ggw`
- FX hydration script: `bun scripts/hydrate-fx.ts` (run inside container for prod DB)
