# PDF Import

Forward a CC/bank statement PDF in Telegram → bot extracts transactions → preview → confirm → batch create in Lunch Money.

## Pipeline

1. **Extract**: `unpdf` extracts text from PDF (`mergePages: true`)
2. **Structure**: `gpt-4o-mini` parses extracted text → JSON array of transactions + close date
3. **Preview**: bot shows all transactions with per-line USD conversion + account picker
4. **Confirm**: user taps account → confirm → `orchestrator.processImport()` creates in LM

## LLM prompt

System prompt in `src/pdf/structure.ts`. Key instructions:
- Argentine CC date layout: year/month on first line of group, day-only on subsequent lines
- `PLATFORM*MERCHANT` patterns: use merchant name, not platform
- Dual amount columns ($ ARS and U$D) determine currency
- Strip installment codes, company suffixes, branch numbers
- Do not skip real transactions, do not invent transactions

Returns `StatementResult: { transactions: StatementTransaction[], closeDate?: string }`

## Dedup

Two levels:
1. **External ID**: `bp_import_{chatId}_{messageId}_{i}` — prevents re-processing same PDF
2. **Amount + date**: skips imported transactions where a manual entry with the same converted USD amount and date already exists (so you can log CC charges on the go and import statement at month end without double-counting)

## FX conversion

Each transaction is converted at the historical blue dollar compra rate for its date. Falls back to current rate if no historical rate is cached within 3 days.

## Undo

All imported transactions share a `split_group_id`. The "Undo All" button calls `orchestrator.undo()` which deletes all legs in the group.

## State management

Pending imports are held in an in-memory `Map<string, PendingImport>` keyed by `${chatId}:${messageId}`. TTL: 30 minutes. No DB persistence — if bot restarts, re-send the PDF.

## Webhook timeout

PDF processing takes 5-15 seconds (download + extract + OpenAI). grammY webhook timeout is set to 55 seconds. An `update_id` dedup middleware prevents Telegram retries from causing duplicate responses.

## Error messages

| Scenario | Message |
|----------|---------|
| No OpenAI key | "PDF import requires OpenAI API key." |
| Not a PDF | "Send a PDF file. Photos aren't supported yet." |
| File > 5MB | "PDF too large (max 5MB)." |
| Download fails | "Couldn't download the file. Try again." |
| Empty extraction | "Couldn't read this PDF. Is it a scanned image?" |
| 0 transactions | "No transactions found in this PDF." |
| LLM API error | "Failed to process PDF. Try again." |
