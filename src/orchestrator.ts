import { BlueplateError, LunchMoneyError, ParseError } from "./errors.js";
import { FXService } from "./fx/index.js";
import { logger } from "./logger.js";
import { LunchMoneyService } from "./lunchmoney/index.js";
import { buildMetadata, transactionToPayload } from "./lunchmoney/mapper.js";
import { PayeeNormalizer } from "./payee.js";
import { inferTagNames, resolveTagIds } from "./tagger.js";
import { parse } from "./parser/index.js";
import type { BlueplateDatabase } from "./storage/database.js";
import type { Transaction, ResolutionContext } from "./types.js";

export interface ProcessResult {
  transaction: Transaction;
  lmTransactionId: number;
  fxRate?: number;
  fxSource?: string;
  categoryName?: string;
  accountName?: string;
  autoTags?: string[];
}

export interface UndoResult {
  payee: string;
  amount: number;
  currency: string;
}

export class Orchestrator {
  private payee: PayeeNormalizer;

  constructor(
    private db: BlueplateDatabase,
    private lm: LunchMoneyService,
    private fx: FXService,
    private defaultCurrency: string
  ) {
    this.payee = new PayeeNormalizer(db);
  }

  async process(text: string, chatId: number, messageId: number): Promise<ProcessResult> {
    const externalId = `bp_${chatId}_${messageId}`;

    // Dedup check
    const existing = this.db.getByExternalId(externalId);
    if (existing) {
      logger.info("Duplicate message, returning cached result", { externalId });
      return {
        transaction: {
          amount: existing.amount,
          currency: existing.currency,
          originalAmount: existing.original_amount ?? undefined,
          originalCurrency: existing.original_currency ?? undefined,
          payee: existing.payee,
          categoryName: existing.category_name ?? undefined,
          date: existing.date,
          externalId,
        },
        lmTransactionId: existing.lm_transaction_id,
        fxRate: existing.fx_rate ?? undefined,
        fxSource: existing.fx_source ?? undefined,
        categoryName: existing.category_name ?? undefined,
      };
    }

    // Build resolution context from cached LM data
    const ctx = await this.getResolutionContext();

    // Parse
    const parsed = parse(text, ctx);
    if (!parsed.ok) {
      if (parsed.error === "ambiguous") {
        throw new ParseError(parsed.message, parsed.candidates);
      }
      throw new ParseError(parsed.message);
    }

    const { expense } = parsed;
    const currency = expense.currency ?? this.defaultCurrency;
    const date = expense.date ?? new Date().toISOString().slice(0, 10);

    // Normalize payee (fuzzy dedup + casing)
    const normalizedPayee = this.payee.normalize(expense.payee);

    // Resolve category
    let categoryId: number | undefined;
    let categoryName: string | undefined;
    if (expense.categoryHint) {
      const categories = await this.lm.getCategories();
      const match = categories.find(
        (c) => c.name.toLowerCase() === expense.categoryHint!.toLowerCase()
      );
      if (match) {
        categoryId = match.id;
        categoryName = match.name;
      }
    }

    // Resolve asset
    let assetId: number | undefined;
    let assetName: string | undefined;
    if (expense.assetHint) {
      const assets = await this.lm.getAccounts();
      const match = assets.find(
        (a) =>
          a.name.toLowerCase() === expense.assetHint!.toLowerCase() ||
          (a.displayName && a.displayName.toLowerCase() === expense.assetHint!.toLowerCase())
      );
      if (match) {
        assetId = match.id;
        assetName = match.name;
      }
    }

    // FX conversion if ARS
    let finalAmount = expense.amount;
    let finalCurrency = currency;
    let originalAmount: number | undefined;
    let originalCurrency: string | undefined;
    let fxRate: number | undefined;
    let fxSource: string | undefined;

    if (currency.toUpperCase() === "ARS") {
      const absAmount = Math.abs(expense.amount);
      const sign = expense.amount < 0 ? -1 : 1;
      const conversion = await this.fx.convert(absAmount, "ARS", "USD");
      finalAmount = conversion.convertedAmount * sign;
      finalCurrency = "USD";
      originalAmount = expense.amount;
      originalCurrency = "ARS";
      fxRate = conversion.rate;
      fxSource = conversion.source;
    }

    // Resolve tags: auto-inferred from category + manual #tags from message
    const autoTagNames = inferTagNames(categoryName);
    const allTagNames = [...new Set([...autoTagNames, ...expense.tags])];
    const tags = await this.lm.getTags();
    const tagIds = resolveTagIds(allTagNames, tags);

    // Build transaction
    const tx: Transaction = {
      amount: finalAmount,
      currency: finalCurrency,
      originalAmount,
      originalCurrency,
      payee: normalizedPayee,
      categoryId,
      categoryName,
      assetId,
      date,
      tags: allTagNames,
      externalId,
    };

    // Build custom_metadata and payload
    const metadata = buildMetadata(tx, chatId, messageId, fxRate, fxSource);
    const payload = transactionToPayload(tx, metadata, expense.note);
    if (tagIds.length > 0) {
      payload.tag_ids = tagIds;
    }
    const lmId = await this.lm.rawClient.createTransaction(payload);

    // Save undo record
    this.db.saveTransaction({
      externalId,
      lmTransactionId: lmId,
      telegramChatId: chatId,
      telegramMessageId: messageId,
      amount: finalAmount,
      currency: finalCurrency,
      originalAmount,
      originalCurrency,
      payee: normalizedPayee,
      categoryName,
      assetName,
      date,
      fxRate,
      fxSource,
    });

    logger.info("Transaction created", { externalId, lmId, amount: finalAmount, currency: finalCurrency });

    return {
      transaction: tx,
      lmTransactionId: lmId,
      fxRate,
      fxSource,
      categoryName,
      accountName: assetName,
      autoTags: allTagNames.length > 0 ? allTagNames : undefined,
    };
  }

  async amend(chatId: number, corrections: {
    amount?: number;
    currency?: string;
    categoryHint?: string;
    assetHint?: string;
    payee?: string;
  }, targetRecordId?: number): Promise<ProcessResult> {
    let record;
    if (targetRecordId != null) {
      record = this.db.getById(targetRecordId);
    }
    if (!record) {
      record = this.db.getLastUndoable(chatId);
    }
    if (!record) {
      throw new BlueplateError("Nothing to amend.", "NO_AMEND", false);
    }

    const ctx = await this.getResolutionContext();
    const updates: Record<string, unknown> = {};

    // Resolve new amount (with FX if needed)
    let newAmount = record.amount;
    let newOriginalAmount = record.original_amount;
    let fxRate = record.fx_rate;
    let fxSource = record.fx_source;

    if (corrections.amount != null) {
      const currency = corrections.currency ?? record.original_currency ?? "ARS";
      if (currency.toUpperCase() === "ARS") {
        const absAmount = Math.abs(corrections.amount);
        const sign = corrections.amount < 0 ? -1 : 1;
        const conversion = await this.fx.convert(absAmount, "ARS", "USD");
        newAmount = conversion.convertedAmount * sign;
        newOriginalAmount = corrections.amount;
        fxRate = conversion.rate;
        fxSource = conversion.source;
      } else {
        newAmount = corrections.amount;
        newOriginalAmount = null;
      }
      updates.amount = newAmount.toFixed(2);
    }

    // Resolve new category
    let categoryId: number | undefined;
    let categoryName = record.category_name ?? undefined;
    if (corrections.categoryHint) {
      const { fuzzyMatchCategory } = await import("./parser/grammar.js");
      const match = fuzzyMatchCategory(corrections.categoryHint, ctx.categories);
      if (match) {
        categoryId = match.id;
        categoryName = match.name;
        updates.category_id = match.id;
      }
    }

    // Resolve new account
    let assetName = record.asset_name ?? undefined;
    if (corrections.assetHint) {
      const assets = ctx.assets;
      const lower = corrections.assetHint.toLowerCase();
      const match = assets.find(
        (a) => a.name.toLowerCase() === lower ||
          (a.displayName && a.displayName.toLowerCase() === lower)
      );
      if (match) {
        assetName = match.name;
        updates.manual_account_id = match.id;
      }
    }

    // Resolve new payee
    let payeeName = record.payee;
    if (corrections.payee) {
      payeeName = this.payee.normalize(corrections.payee);
      updates.payee = payeeName;
    }

    if (Object.keys(updates).length === 0) {
      throw new BlueplateError("No valid corrections found.", "NO_CORRECTIONS", false);
    }

    // Update in LM
    await this.lm.rawClient.updateTransaction(record.lm_transaction_id, updates as any);

    // Update local record (re-save with new values)
    logger.info("Transaction amended", { lmId: record.lm_transaction_id, updates });

    return {
      transaction: {
        amount: newAmount,
        currency: record.currency,
        originalAmount: newOriginalAmount ?? undefined,
        originalCurrency: record.original_currency ?? undefined,
        payee: payeeName,
        categoryName,
        date: record.date,
        externalId: record.external_id,
      },
      lmTransactionId: record.lm_transaction_id,
      fxRate: fxRate ?? undefined,
      fxSource: fxSource ?? undefined,
      categoryName,
      accountName: assetName,
    };
  }

  async undo(chatId: number): Promise<UndoResult> {
    const record = this.db.getLastUndoable(chatId);
    if (!record) {
      throw new BlueplateError("Nothing to undo.", "NO_UNDO", false);
    }

    // Try DELETE first, fall back to mark-as-undone
    let deleted = false;
    try {
      deleted = await this.lm.rawClient.deleteTransaction(record.lm_transaction_id);
    } catch (error) {
      if (error instanceof LunchMoneyError && error.statusCode === 404) {
        // Already deleted or v2 DELETE not available
        deleted = true;
      } else {
        // Fall back to update strategy
        logger.warn("DELETE failed, falling back to update", { error: String(error) });
        try {
          await this.lm.rawClient.updateTransaction(record.lm_transaction_id, {
            payee: `[UNDONE] ${record.payee}`,
            amount: "0",
            status: "unreviewed",
          });
        } catch (updateError) {
          throw new LunchMoneyError(`Failed to undo: ${updateError}`);
        }
      }
    }

    this.db.markUndone(record.id);
    logger.info("Transaction undone", { id: record.id, lmId: record.lm_transaction_id, deleted });

    return {
      payee: record.payee,
      amount: record.amount,
      currency: record.currency,
    };
  }

  async getResolutionContext(): Promise<ResolutionContext> {
    const [categories, assets, tags] = await Promise.all([
      this.lm.getCategories(),
      this.lm.getAccounts(),
      this.lm.getTags(),
    ]);

    return {
      categories,
      assets,
      tags,
      defaultCurrency: this.defaultCurrency,
    };
  }
}
