# Parser

Converts free text (typed or voice-transcribed) into structured expense data.

## Pipeline

```
input text → tokenize → buildExpense → ParseOutcome
```

## Tokenizer (`src/parser/tokenizer.ts`)

Splits input on whitespace, classifies each token:

| Type | Examples | Notes |
|------|----------|-------|
| `amount` | `1500`, `14.500`, `20,200`, `5k`, `1.5m`, `$12.50` | Argentine format: `.` = thousands, `,` = decimal |
| `currency` | `usd`, `dolares`, `pesos`, `ars` | Mapped to ISO codes |
| `date` | `hoy`, `ayer`, `date:2026-03-15` | Keywords or explicit |
| `tag` | `#recurring` | Starts with `#` |
| `note` | `note:birthday` | Starts with `note:` |
| `split` | `split` | People-split marker |
| `text` | everything else | Candidate for payee, category, or asset |

Trailing punctuation (`,` `.`) is stripped before classification. This handles voice transcription artifacts like "15000," or "desayuno."

## Grammar (`src/parser/grammar.ts`)

Builds a `ParsedExpense` from tokens:

1. Must have at least one amount
2. Multiple amounts → try account-split detection (e.g., "pizza 15k mp:5k visa:10k")
3. Text tokens scanned from end for category match, then asset match
4. Remaining text tokens become the payee
5. If only one text token and it matches a category alias, it serves as both payee and categoryHint

### Category aliases

`CATEGORY_ALIASES` maps Spanish/shorthand words to English LM category names:

```
café → Coffee Shops, comida → Restaurants/Groceries, nafta → Gas,
estacionamiento → Car Maintenance, desayuno → Coffee Shops, etc.
```

Matching: exact → prefix (≥3 chars) → contains (≥4 chars). Emoji-stripped for comparison.

### Account split detection

Supports two patterns:
- Compound: `mp:5k visa:10k` (text:amount glued with `:`)
- Voice: `5000 mercado pago 10000 visa` (amount followed by account name)

Tries 2-word phrases first for multi-word accounts ("mercado pago").

## Corrections (`src/parser/corrections.ts`)

Parses amendment text to modify the last transaction: new amount, category, account, or payee.
