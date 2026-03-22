# Lunch Money v2 API

Base URL: `https://api.lunchmoney.dev/v2`
Docs: https://alpha.lunchmoney.dev/v2/docs
Migration guide: https://alpha.lunchmoney.dev/v2/migration-guide

**Do NOT use v1.** Do NOT use `alpha.lunchmoney.dev/v2` (sandbox with demo data).

## Key differences from v1

| v1 | v2 |
|----|-----|
| `/assets` | `/manual_accounts` (response key: `manual_accounts`) |
| `asset_id` | `manual_account_id` on transactions |
| `tags` (object array) | `tag_ids` (integer array) |
| `cleared` / `uncleared` | `reviewed` / `unreviewed` |
| POST returns 200 with IDs | POST returns **201** with full objects |
| DELETE returns 200 with `true` | DELETE returns **204 No Content** |
| PUT wraps in `{ transaction: ... }` | PUT sends payload directly |

## Create transactions

```
POST /transactions
Body: { transactions: [...], skip_duplicates: true }
Response (201): { transactions: [...], skipped_duplicates: [...] }
```

`skipped_duplicates` entries have `request_transactions_index` to map back to input order.

## Transaction payload

```typescript
{
  date: string;           // YYYY-MM-DD
  amount: string | number;
  currency?: string;      // lowercase: "usd", "ars"
  payee?: string;
  category_id?: number;
  manual_account_id?: number;
  tag_ids?: number[];
  external_id?: string;
  status?: "reviewed" | "unreviewed";
  notes?: string;
  custom_metadata?: Record<string, unknown>;
}
```

## Other endpoints

- `GET /categories` — nested by default (groups have `children`)
- `GET /manual_accounts` — replaces `/assets`
- `GET /tags`
- `GET /transactions?start_date=...&end_date=...`
- `PUT /transactions/{id}` — partial update
- `DELETE /transactions/{id}` — returns 204
