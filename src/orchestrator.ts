import { BlueplateError, LunchMoneyError, ParseError } from "./errors.js";
import { FXService } from "./fx/index.js";
import { logger } from "./logger.js";
import { LunchMoneyService } from "./lunchmoney/index.js";
import { buildMetadata, transactionToPayload } from "./lunchmoney/mapper.js";
import { PayeeNormalizer } from "./payee.js";
import { inferTagNames, resolveTagIds } from "./tagger.js";
import { parse } from "./parser/index.js";
import { fuzzyMatchCategory, fuzzyMatchAsset } from "./parser/grammar.js";
import type { BlueplateDatabase } from "./storage/database.js";
import type { Transaction, ResolutionContext, CachedCategory, CachedAsset } from "./types.js";

export interface ProcessResult {
  transaction: Transaction;
  lmTransactionId: number;
  localRecordId?: number;
  fxRate?: number;
  fxSource?: string;
  categoryName?: string;
  accountName?: string;
  autoTags?: string[];
  splitCount?: number;
}

export interface UndoResult {
  payee: string;
  amount: number;
  currency: string;
}

interface FXResult {
  amount: number;
  currency: string;
  originalAmount?: number;
  originalCurrency?: string;
  fxRate?: number;
  fxSource?: string;
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

  private async convertIfArs(amount: number, currency: string): Promise<FXResult> {
    if (currency.toUpperCase() !== "ARS") {
      return { amount, currency };
    }
    const absAmount = Math.abs(amount);
    const sign = amount < 0 ? -1 : 1;
    const conversion = await this.fx.convert(absAmount, "ARS", "USD");
    return {
      amount: conversion.convertedAmount * sign,
      currency: "USD",
      originalAmount: amount,
      originalCurrency: "ARS",
      fxRate: conversion.rate,
      fxSource: conversion.source,
    };
  }

  private resolveCategory(hint: string, categories: CachedCategory[]): { id: number; name: string } | null {
    const match = fuzzyMatchCategory(hint, categories);
    return match ? { id: match.id, name: match.name } : null;
  }

  private resolveAsset(hint: string, assets: CachedAsset[]): { id: number; name: string } | null {
    const match = fuzzyMatchAsset(hint, assets);
    return match ? { id: match.id, name: match.name } : null;
  }

  async process(text: string, chatId: number, messageId: number): Promise<ProcessResult> {
    const ctx = await this.getResolutionContext();

    const parsed = parse(text, ctx);
    if (!parsed.ok) {
      if (parsed.error === "ambiguous") {
        throw new ParseError(parsed.message, parsed.candidates);
      }
      throw new ParseError(parsed.message);
    }

    const { expense } = parsed;

    return this.processExpense({
      amount: expense.splitCount ? expense.amount / expense.splitCount : expense.amount,
      currency: expense.currency,
      payee: expense.payee,
      categoryHint: expense.categoryHint,
      assetHint: expense.assetHint,
      tags: expense.tags,
      note: expense.note,
      date: expense.date,
      splitCount: expense.splitCount,
    }, chatId, messageId, ctx);
  }

  async processStructured(input: {
    payee: string;
    amount: number;
    currency?: string;
    categoryHint?: string;
    assetHint?: string;
    tags?: string[];
    note?: string;
    date?: string;
  }, chatId: number, messageId: number): Promise<ProcessResult> {
    const ctx = await this.getResolutionContext();
    return this.processExpense({
      amount: input.amount,
      currency: input.currency,
      payee: input.payee,
      categoryHint: input.categoryHint,
      assetHint: input.assetHint,
      tags: input.tags ?? [],
      note: input.note,
      date: input.date,
    }, chatId, messageId, ctx);
  }

  private async processExpense(input: {
    amount: number;
    currency?: string;
    payee: string;
    categoryHint?: string;
    assetHint?: string;
    tags: string[];
    note?: string;
    date?: string;
    splitCount?: number;
  }, chatId: number, messageId: number, ctx: ResolutionContext): Promise<ProcessResult> {
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

    const currency = input.currency ?? this.defaultCurrency;
    const date = input.date ?? new Date().toISOString().slice(0, 10);
    const normalizedPayee = this.payee.normalize(input.payee);

    // Resolve category
    const category = input.categoryHint ? this.resolveCategory(input.categoryHint, ctx.categories) : null;

    // Resolve asset
    const asset = input.assetHint ? this.resolveAsset(input.assetHint, ctx.assets) : null;

    // FX conversion
    const fxResult = await this.convertIfArs(input.amount, currency);

    // Resolve tags
    const autoTagNames = inferTagNames(category?.name);
    const allTagNames = [...new Set([...autoTagNames, ...input.tags])];
    const tagIds = resolveTagIds(allTagNames, ctx.tags);

    // Build transaction
    const tx: Transaction = {
      amount: fxResult.amount,
      currency: fxResult.currency,
      originalAmount: fxResult.originalAmount,
      originalCurrency: fxResult.originalCurrency,
      payee: normalizedPayee,
      categoryId: category?.id,
      categoryName: category?.name,
      assetId: asset?.id,
      date,
      tags: allTagNames,
      externalId,
    };

    // Build payload and create in LM
    const metadata = buildMetadata(tx, chatId, messageId, fxResult.fxRate, fxResult.fxSource);
    const payload = transactionToPayload(tx, metadata, input.note);
    if (tagIds.length > 0) {
      payload.tag_ids = tagIds;
    }
    const lmId = await this.lm.rawClient.createTransaction(payload);

    // Save undo record
    const localRecordId = this.db.saveTransaction({
      externalId,
      lmTransactionId: lmId,
      telegramChatId: chatId,
      telegramMessageId: messageId,
      amount: fxResult.amount,
      currency: fxResult.currency,
      originalAmount: fxResult.originalAmount,
      originalCurrency: fxResult.originalCurrency,
      payee: normalizedPayee,
      categoryName: category?.name,
      assetName: asset?.name,
      date,
      fxRate: fxResult.fxRate,
      fxSource: fxResult.fxSource,
    });

    logger.info("Transaction created", { externalId, lmId, amount: fxResult.amount, currency: fxResult.currency });

    return {
      transaction: tx,
      lmTransactionId: lmId,
      localRecordId,
      fxRate: fxResult.fxRate,
      fxSource: fxResult.fxSource,
      categoryName: category?.name,
      accountName: asset?.name,
      autoTags: allTagNames.length > 0 ? allTagNames : undefined,
      splitCount: input.splitCount,
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
      const fxResult = await this.convertIfArs(corrections.amount, currency);
      newAmount = fxResult.amount;
      newOriginalAmount = fxResult.originalAmount ?? null;
      fxRate = fxResult.fxRate ?? null;
      fxSource = fxResult.fxSource ?? null;
      updates.amount = newAmount.toFixed(2);
    }

    // Resolve new category
    let categoryName = record.category_name ?? undefined;
    if (corrections.categoryHint) {
      const match = this.resolveCategory(corrections.categoryHint, ctx.categories);
      if (match) {
        categoryName = match.name;
        updates.category_id = match.id;
      }
    }

    // Resolve new account
    let assetName = record.asset_name ?? undefined;
    if (corrections.assetHint) {
      const match = this.resolveAsset(corrections.assetHint, ctx.assets);
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

    // Update local record
    this.db.updateTransactionFields(record.id, {
      amount: corrections.amount != null ? newAmount : undefined,
      originalAmount: corrections.amount != null ? newOriginalAmount : undefined,
      payee: corrections.payee ? payeeName : undefined,
      categoryName: corrections.categoryHint ? categoryName : undefined,
      assetName: corrections.assetHint ? assetName : undefined,
      fxRate: corrections.amount != null ? (fxRate ?? undefined) : undefined,
      fxSource: corrections.amount != null ? (fxSource ?? undefined) : undefined,
    });
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

  async undo(chatId: number, recordId?: number): Promise<UndoResult> {
    const record = recordId != null
      ? this.db.getById(recordId)
      : this.db.getLastUndoable(chatId);
    if (!record) {
      throw new BlueplateError("Nothing to undo.", "NO_UNDO", false);
    }

    // Try DELETE first, fall back to mark-as-undone
    let deleted = false;
    try {
      deleted = await this.lm.rawClient.deleteTransaction(record.lm_transaction_id);
    } catch (error) {
      if (error instanceof LunchMoneyError && error.statusCode === 404) {
        deleted = true;
      } else {
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
