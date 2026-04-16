# Image Import

Send a screenshot or photo of a receipt / order list / payment app screen in Telegram → vision model extracts transactions → preview → confirm → batch create in Lunch Money.

## Accepted inputs

| Input | Handling |
|-------|----------|
| Photo (compressed) | `bot.on("message:photo")`, largest `PhotoSize` downloaded |
| Document `image/*` (uncompressed) | `bot.on("message:document")` branch for `mime.startsWith("image/")` |
| Album (media group) | Not supported yet — prompts "send one photo at a time" |

Size cap: 5MB (same as PDF).

## Pipeline

1. **Download**: pull the image bytes from Telegram.
2. **Structure**: `structureImage(buffer, apiKey)` calls `gpt-4o` with the image as a base64 `data:` URL. Returns `StatementResult` with optional `categoryHint` per transaction.
3. **Preview**: reuses the same import preview + account picker UX as PDF.
4. **Confirm**: `orchestrator.processImport()` creates in LM, inferring category + auto-tags per transaction from `categoryHint`.

## Vision prompt

System prompt in `src/vision/structure.ts`. Key instructions:

- Uses today's date as an anchor for year inference. If a parsed date would land in the future, it's rolled back by one year.
- Argentine conventions: Spanish month abbreviations, `1.234,56` number format.
- Payee normalization (title case, strip noise, handle `PLATFORM*MERCHANT`).
- Optional `category_hint` — free-form (e.g. `food delivery`, `groceries`, `restaurants`). Downstream, `fuzzyMatchCategory` maps this to the user's configured LM categories.

## Category inference

`processImport` only fetches categories/tags when at least one transaction carries a `categoryHint` (PDF imports don't, so they skip the LM round-trip). When a hint resolves to a category, `inferTagNames` adds the usual auto-tags (e.g. `eating-out` for `restaurants`).

## Dedup

Same as PDF import:

1. **External ID**: `bp_import_{chatId}_{messageId}_{i}` — prevents re-processing the same image message.
2. **Amount + date**: skips imported transactions where a manual entry with the same converted USD amount and date already exists.

## FX conversion

Same as PDF: each transaction uses the historical blue dollar compra rate for its date, falling back to the current rate if no cached rate is within 3 days.

## Undo

All imported transactions share a `split_group_id`; "Undo All" deletes all legs.

## Error messages

| Scenario | Message |
|----------|---------|
| No OpenAI key | "Import requires OpenAI API key." |
| Unsupported document mime | "Send a PDF or image file." |
| Album sent | "Send one photo at a time — albums aren't supported yet." |
| File > 5MB | "Image too large (max 5MB)." |
| Download fails | "Couldn't process the photo. Try again." / "Couldn't download the file. Try again." |
| Vision API error | "Failed to process image. Try again." |
| 0 transactions | "No transactions found in this image." |

## Model + cost

Hardcoded to `gpt-4o` (not `-mini`) for vision accuracy on small text and Spanish layouts. Can be overridden with the `model` option on `structureImage` if cost becomes an issue.

## Limitations (phase 1)

- No album (media group) handling — send one photo per message.
- No interactive edit-in-preview. If the extracted date is wrong, cancel and re-send with a clearer image.
- Scanned-PDF fallback still routes through the PDF path (unpdf), which doesn't OCR. Send scanned receipts as images instead.
