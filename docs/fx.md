# FX Conversion

All ARS amounts are converted to USD using the blue dollar **compra** (buy) rate.
Rationale: you sell USD to cover ARS expenses, so compra is what you'd receive.

## Live rate

Source: DolarAPI.com `GET /v1/dolares/blue` → `compra` field.
Cached in-memory with configurable TTL (default 5 min). Falls back to DB cache if API is down (< 1 hour stale).

## Historical rates

Source: ArgentinaDatos API `GET /v1/cotizaciones/dolares/blue` → `compra` field.
Daily rates from 2011 to present. Hydrated into `fx_rates` table.

### Hydration script

```bash
bun scripts/hydrate-fx.ts [--db path] [--since YYYY-MM-DD]
```

Defaults to 2024-01-01 onward (~800 records). Safe to re-run — skips existing dates.
For production, run inside the container against `/app/data/blueplate.db`.

## Rate lookup

`db.getRateNearDate(pair, date)` finds the rate whose `source_timestamp` is closest to the given date. Uses indexed query on `(pair, source_timestamp)`.

The orchestrator's `resolveRateForDate(date)` wraps this with a 3-day staleness threshold — if the nearest rate is > 3 days away, returns null and falls back to the current live rate.

## Per-transaction vs batch rate

- **Manual entries**: use current live rate (same as typing "pizza 14000" right now)
- **PDF imports**: use historical rate for each transaction's date individually
- **Preview**: `orchestrator.previewImport()` computes per-transaction USD without creating anything

## Database schema

```sql
fx_rates (pair TEXT, rate REAL, source TEXT, source_timestamp TEXT, fetched_at TEXT)
CREATE INDEX idx_fx_rates_pair_source_ts ON fx_rates (pair, source_timestamp)
```
