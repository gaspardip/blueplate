import { BlueplateError, LunchMoneyError, ParseError } from "./errors.js";
import { FXService } from "./fx/index.js";
import { logger } from "./logger.js";
import { LunchMoneyService } from "./lunchmoney/index.js";
import { buildMetadata, transactionToPayload } from "./lunchmoney/mapper.js";
import { PayeeNormalizer } from "./payee.js";
import { inferTagNames, resolveTagIds } from "./tagger.js";
import { parse } from "./parser/index.js";
import { fuzzyMatchCategory, fuzzyMatchAsset } from "./parser/grammar.js";
import type { BlueplateDatabase, TransactionRow } from "./storage/database.js";
import type { Transaction, ResolutionContext, CachedCategory, CachedAsset } from "./types.js";
import type { ParsedExpense } from "./parser/types.js";
import type { LMCreateTransactionPayload, LMUpdateTransactionPayload, BlueplateMetadata } from "./lunchmoney/types.js";
import { todayStr, stripEmoji } from "./utils.js";
import type { StatementTransaction } from "./pdf/index.js";

export interface AccountLeg {
  accountName: string;
  amount: number;
  originalAmount?: number;
  lmTransactionId: number;
  localRecordId: number;
}

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
  accountLegs?: AccountLeg[];
  splitGroupId?: number;
}

export interface ImportResult {
  created: number;
  skipped: number;
  splitGroupId: number | null;
  accountName: string;
}

export interface FxSellResult {
  usdAmount: number;
  arsAmount: number;
  rate: number;
  usdAccountName: string;
  arsAccountName: string;
  splitGroupId: number;
}

export interface UndoResult {
  payee: string;
  amount: number;
  currency: string;
}

interface PreparedTx {
  stx: StatementTransaction;
  globalIndex: number;
  externalId: string;
  fxResult: FXResult;
  normalizedPayee: string;
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

    // Multi-account split path
    if (expense.accountSplits && expense.accountSplits.length >= 2) {
      return this.processMultiAccount(expense, chatId, messageId, ctx);
    }

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
    const date = input.date ?? todayStr();
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

  private async processMultiAccount(
    expense: ParsedExpense,
    chatId: number,
    messageId: number,
    ctx: ResolutionContext
  ): Promise<ProcessResult> {
    const splits = expense.accountSplits!;
    const currency = expense.currency ?? this.defaultCurrency;
    const date = expense.date ?? todayStr();
    const normalizedPayee = this.payee.normalize(expense.payee);

    // Resolve category
    const category = expense.categoryHint ? this.resolveCategory(expense.categoryHint, ctx.categories) : null;

    // Resolve tags
    const autoTagNames = inferTagNames(category?.name);
    const allTagNames = [...new Set([...autoTagNames, ...expense.tags])];
    const tagIds = resolveTagIds(allTagNames, ctx.tags);

    // Build payloads for all legs
    const payloads: LMCreateTransactionPayload[] = [];
    const legData: Array<{
      asset: { id: number; name: string } | null;
      fxResult: FXResult;
      externalId: string;
    }> = [];

    for (let i = 0; i < splits.length; i++) {
      const leg = splits[i];
      const externalId = `bp_${chatId}_${messageId}_${i}`;

      // Dedup check per leg
      const existing = this.db.getByExternalId(externalId);
      if (existing) {
        logger.info("Duplicate multi-account message, returning cached", { externalId });
        // If first leg exists, all should — fetch the group
        const groupRecords = existing.split_group_id != null
          ? this.db.getByGroupId(existing.split_group_id)
          : [existing];
        return this.buildMultiAccountResult(groupRecords, normalizedPayee, category?.name, date, allTagNames);
      }

      const asset = this.resolveAsset(leg.assetHint, ctx.assets);
      const fxResult = await this.convertIfArs(leg.amount, currency);

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

      const metadata = buildMetadata(tx, chatId, messageId, fxResult.fxRate, fxResult.fxSource);
      const payload = transactionToPayload(tx, metadata, expense.note);
      if (tagIds.length > 0) {
        payload.tag_ids = tagIds;
      }

      payloads.push(payload);
      legData.push({ asset, fxResult, externalId });
    }

    // Create all legs in one API call
    const lmIds = await this.lm.rawClient.createTransactions(payloads);

    // Save local records
    const localRecordIds: number[] = [];
    for (let i = 0; i < splits.length; i++) {
      const { asset, fxResult, externalId } = legData[i];
      const localId = this.db.saveTransaction({
        externalId,
        lmTransactionId: lmIds[i],
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
      localRecordIds.push(localId);
    }

    // Set split_group_id on all records (use first record's id)
    const groupId = localRecordIds[0];
    this.db.setSplitGroupId(localRecordIds, groupId);

    // Build result
    const accountLegs: AccountLeg[] = splits.map((leg, i) => ({
      accountName: legData[i].asset?.name ?? leg.assetHint,
      amount: legData[i].fxResult.amount,
      originalAmount: legData[i].fxResult.originalAmount,
      lmTransactionId: lmIds[i],
      localRecordId: localRecordIds[i],
    }));

    // Use first leg's FX info for the summary line
    const firstFx = legData[0].fxResult;
    const totalAmount = accountLegs.reduce((s, l) => s + l.amount, 0);
    const totalOriginal = legData.every((l) => l.fxResult.originalAmount != null)
      ? splits.reduce((s, l) => s + l.amount, 0)
      : undefined;

    logger.info("Multi-account transaction created", {
      groupId,
      legs: splits.length,
      lmIds,
      totalAmount,
    });

    return {
      transaction: {
        amount: totalAmount,
        currency: firstFx.currency,
        originalAmount: totalOriginal,
        originalCurrency: firstFx.originalCurrency,
        payee: normalizedPayee,
        categoryId: category?.id,
        categoryName: category?.name,
        date,
        externalId: legData[0].externalId,
      },
      lmTransactionId: lmIds[0],
      localRecordId: localRecordIds[0],
      fxRate: firstFx.fxRate,
      fxSource: firstFx.fxSource,
      categoryName: category?.name,
      autoTags: allTagNames.length > 0 ? allTagNames : undefined,
      accountLegs,
      splitGroupId: groupId,
    };
  }

  private buildMultiAccountResult(
    records: TransactionRow[],
    payee: string,
    categoryName: string | undefined,
    date: string,
    tags: string[]
  ): ProcessResult {
    const totalAmount = records.reduce((s, r) => s + r.amount, 0);
    const totalOriginal = records.every((r) => r.original_amount != null)
      ? records.reduce((s, r) => s + (r.original_amount ?? 0), 0)
      : undefined;

    return {
      transaction: {
        amount: totalAmount,
        currency: records[0].currency,
        originalAmount: totalOriginal,
        originalCurrency: records[0].original_currency ?? undefined,
        payee,
        categoryName,
        date,
        externalId: records[0].external_id,
      },
      lmTransactionId: records[0].lm_transaction_id,
      localRecordId: records[0].id,
      fxRate: records[0].fx_rate ?? undefined,
      fxSource: records[0].fx_source ?? undefined,
      categoryName,
      autoTags: tags.length > 0 ? tags : undefined,
      accountLegs: records.map((r) => ({
        accountName: r.asset_name ?? "Unknown",
        amount: r.amount,
        originalAmount: r.original_amount ?? undefined,
        lmTransactionId: r.lm_transaction_id,
        localRecordId: r.id,
      })),
      splitGroupId: records[0].split_group_id ?? undefined,
    };
  }

  async processImport(
    transactions: StatementTransaction[],
    chatId: number,
    messageId: number,
    assetId: number,
    assetName: string,
  ): Promise<ImportResult> {
    // Dedup check on the first leg's external_id
    const firstExternalId = `bp_import_${chatId}_${messageId}_0`;
    const existing = this.db.getByExternalId(firstExternalId);
    if (existing && existing.split_group_id != null) {
      const group = this.db.getByGroupId(existing.split_group_id);
      return {
        created: group.length,
        skipped: 0,
        splitGroupId: existing.split_group_id,
        accountName: assetName,
      };
    }

    // Resolve a fallback FX rate (current) in case no historical rate is cached.
    const fallbackFx = await this.resolveImportFxRate();

    // Pre-compute FX results and filter out duplicates (same amount + date already logged manually)
    const prepared: PreparedTx[] = [];
    let skipped = 0;

    // Build a set of existing (amount, date) pairs for fast lookup — single range query
    const existingByDate = new Map<string, Set<number>>();
    const sortedDates = transactions.map((t) => t.date).sort();
    const minDate = sortedDates[0];
    const maxDate = sortedDates[sortedDates.length - 1];
    const existingRows = this.db.getTransactionsForDateRange(chatId, minDate, maxDate);
    for (const row of existingRows) {
      const amounts = existingByDate.get(row.date) ?? new Set<number>();
      amounts.add(row.amount);
      existingByDate.set(row.date, amounts);
    }

    for (let i = 0; i < transactions.length; i++) {
      const stx = transactions[i];
      const externalId = `bp_import_${chatId}_${messageId}_${i}`;
      const currency = stx.currency ?? this.defaultCurrency;
      const normalizedPayee = this.payee.normalize(stx.payee);
      const txFx = this.resolveRateForDate(stx.date) ?? fallbackFx;
      const fxResult = this.convertAtRate(stx.amount, currency, txFx);

      // Skip if a manual entry with the same converted amount + date already exists
      const existingAmounts = existingByDate.get(stx.date);
      if (existingAmounts?.has(fxResult.amount)) {
        logger.info("Import skipping duplicate", {
          date: stx.date,
          payee: normalizedPayee,
          amount: fxResult.amount,
        });
        skipped++;
        continue;
      }

      prepared.push({ stx, globalIndex: i, externalId, fxResult, normalizedPayee });
    }

    if (prepared.length === 0) {
      return {
        created: 0,
        skipped,
        splitGroupId: null,
        accountName: assetName,
      };
    }

    // Batch create in LM
    const BATCH_SIZE = 50;
    const allLocalIds: number[] = [];

    for (let batchStart = 0; batchStart < prepared.length; batchStart += BATCH_SIZE) {
      const batch = prepared.slice(batchStart, batchStart + BATCH_SIZE);
      const payloads: LMCreateTransactionPayload[] = [];

      for (const p of batch) {
        const tx: Transaction = {
          amount: p.fxResult.amount,
          currency: p.fxResult.currency,
          originalAmount: p.fxResult.originalAmount,
          originalCurrency: p.fxResult.originalCurrency,
          payee: p.normalizedPayee,
          assetId,
          date: p.stx.date,
          externalId: p.externalId,
        };

        const metadata = buildMetadata(tx, chatId, messageId, p.fxResult.fxRate, p.fxResult.fxSource);
        const payload = transactionToPayload(tx, metadata);
        payload.manual_account_id = assetId;
        payload.status = "unreviewed";
        payloads.push(payload);
      }

      const lmIds = await this.lm.rawClient.createTransactions(payloads);

      for (let i = 0; i < batch.length; i++) {
        const p = batch[i];
        const localId = this.db.saveTransaction({
          externalId: p.externalId,
          lmTransactionId: lmIds[i],
          telegramChatId: chatId,
          telegramMessageId: messageId,
          amount: p.fxResult.amount,
          currency: p.fxResult.currency,
          originalAmount: p.fxResult.originalAmount,
          originalCurrency: p.fxResult.originalCurrency,
          payee: p.normalizedPayee,
          assetName,
          date: p.stx.date,
          fxRate: p.fxResult.fxRate,
          fxSource: p.fxResult.fxSource,
        });
        allLocalIds.push(localId);
      }
    }

    // Link all records via split_group_id for undo-all
    const groupId = allLocalIds[0];
    this.db.setSplitGroupId(allLocalIds, groupId);

    logger.info("Import created", {
      groupId,
      created: allLocalIds.length,
      skipped,
      assetName,
    });

    return {
      created: allLocalIds.length,
      skipped,
      splitGroupId: groupId,
      accountName: assetName,
    };
  }

  async previewImport(
    transactions: StatementTransaction[],
  ): Promise<Array<{ usdAmount: number; rate: number; isConverted: boolean }>> {
    const fallbackFx = await this.resolveImportFxRate();
    return transactions.map((stx) => {
      const currency = stx.currency ?? this.defaultCurrency;
      const fx = this.resolveRateForDate(stx.date) ?? fallbackFx;
      const result = this.convertAtRate(stx.amount, currency, fx);
      const isConverted = currency.toUpperCase() === "ARS";
      return { usdAmount: result.amount, rate: result.fxRate ?? fx.rate, isConverted };
    });
  }

  private resolveRateForDate(date: string): { rate: number; source: string } | null {
    const historical = this.db.getRateNearDate("ARS/USD", date);
    if (!historical) return null;

    // Only use if within 3 days of the target date (skip if too far)
    const targetMs = new Date(`${date}T23:59:59Z`).getTime();
    const rateMs = new Date(historical.source_timestamp).getTime();
    const diffDays = Math.abs(targetMs - rateMs) / (1000 * 60 * 60 * 24);
    if (diffDays > 3) return null;

    return { rate: historical.rate, source: historical.source };
  }

  private async resolveImportFxRate(): Promise<{ rate: number; source: string }> {
    const quote = await this.fx.getBlueRate();
    return { rate: quote.rate, source: quote.source };
  }

  private convertAtRate(
    amount: number,
    currency: string,
    fx: { rate: number; source: string } | null,
  ): FXResult {
    if (currency.toUpperCase() !== "ARS" || !fx) {
      return { amount, currency };
    }
    const absAmount = Math.abs(amount);
    const sign = amount < 0 ? -1 : 1;
    const converted = Math.round((absAmount / fx.rate) * 100) / 100;
    return {
      amount: converted * sign,
      currency: "USD",
      originalAmount: amount,
      originalCurrency: "ARS",
      fxRate: fx.rate,
      fxSource: fx.source,
    };
  }

  async processFxSell(
    usdAmount: number,
    rate: number,
    chatId: number,
    messageId: number,
    sellDate?: string,
  ): Promise<FxSellResult> {
    const ctx = await this.getResolutionContext();
    const arsAmount = Math.round(usdAmount * rate * 100) / 100;

    // Find accounts by currency
    const usdAccount = ctx.assets.find((a) => a.currency.toLowerCase() === "usd");
    const arsAccount = ctx.assets.find((a) => a.currency.toLowerCase() === "ars");
    if (!usdAccount) throw new BlueplateError("No USD account found.", "NO_ACCOUNT", false);
    if (!arsAccount) throw new BlueplateError("No ARS account found.", "NO_ACCOUNT", false);

    // Find "Payment, Transfer" category
    const transferCat = ctx.categories.find((c) =>
      stripEmoji(c.name).toLowerCase().includes("payment") ||
      stripEmoji(c.name).toLowerCase().includes("transfer"),
    );

    const date = sellDate ?? todayStr();
    const payee = "FX Sell USD→ARS";
    const usdExternalId = `bp_sell_${chatId}_${messageId}_0`;
    const arsExternalId = `bp_sell_${chatId}_${messageId}_1`;

    // Dedup check
    const existing = this.db.getByExternalId(usdExternalId);
    if (existing && existing.split_group_id != null) {
      return {
        usdAmount,
        arsAmount,
        rate,
        usdAccountName: usdAccount.name,
        arsAccountName: arsAccount.name,
        splitGroupId: existing.split_group_id,
      };
    }

    const meta: BlueplateMetadata = {
      blueplate_version: 1,
      ingested_via: "telegram",
      telegram_chat_id: chatId,
      telegram_message_id: messageId,
      fx_rate: rate,
      fx_mode: "manual_sell",
      fx_source: "user",
    };

    const payloads: LMCreateTransactionPayload[] = [
      {
        date,
        amount: usdAmount.toFixed(2),
        currency: "usd",
        payee,
        manual_account_id: usdAccount.id,
        category_id: transferCat?.id,
        external_id: usdExternalId,
        status: "reviewed",
        custom_metadata: meta as Record<string, unknown>,
      },
      {
        date,
        amount: (-arsAmount).toFixed(2),
        currency: "ars",
        payee,
        manual_account_id: arsAccount.id,
        category_id: transferCat?.id,
        external_id: arsExternalId,
        status: "reviewed",
        custom_metadata: meta as Record<string, unknown>,
      },
    ];

    const lmIds = await this.lm.rawClient.createTransactions(payloads);

    const usdLocalId = this.db.saveTransaction({
      externalId: usdExternalId,
      lmTransactionId: lmIds[0],
      telegramChatId: chatId,
      telegramMessageId: messageId,
      amount: usdAmount,
      currency: "USD",
      payee,
      categoryName: transferCat?.name,
      assetName: usdAccount.name,
      date,
      fxRate: rate,
      fxSource: "user",
    });

    const arsLocalId = this.db.saveTransaction({
      externalId: arsExternalId,
      lmTransactionId: lmIds[1],
      telegramChatId: chatId,
      telegramMessageId: messageId,
      amount: -arsAmount,
      currency: "ARS",
      payee,
      categoryName: transferCat?.name,
      assetName: arsAccount.name,
      date,
      fxRate: rate,
      fxSource: "user",
    });

    this.db.setSplitGroupId([usdLocalId, arsLocalId], usdLocalId);

    logger.info("FX sell created", { usdAmount, arsAmount, rate, groupId: usdLocalId });

    return {
      usdAmount,
      arsAmount,
      rate,
      usdAccountName: usdAccount.name,
      arsAccountName: arsAccount.name,
      splitGroupId: usdLocalId,
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
      if (!record) {
        throw new BlueplateError("That transaction was already undone.", "NO_AMEND", false);
      }
    } else {
      record = this.db.getLastUndoable(chatId);
      if (!record) {
        throw new BlueplateError("Nothing to amend.", "NO_AMEND", false);
      }
    }

    const ctx = await this.getResolutionContext();
    const lmUpdate: LMUpdateTransactionPayload = {};

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
      lmUpdate.amount = newAmount.toFixed(2);
    }

    // Resolve new category
    let categoryName = record.category_name ?? undefined;
    if (corrections.categoryHint) {
      const match = this.resolveCategory(corrections.categoryHint, ctx.categories);
      if (match) {
        categoryName = match.name;
        lmUpdate.category_id = match.id;
      }
    }

    // Resolve new account
    let assetName = record.asset_name ?? undefined;
    if (corrections.assetHint) {
      const match = this.resolveAsset(corrections.assetHint, ctx.assets);
      if (match) {
        assetName = match.name;
        lmUpdate.manual_account_id = match.id;
      }
    }

    // Resolve new payee
    let payeeName = record.payee;
    if (corrections.payee) {
      payeeName = this.payee.normalize(corrections.payee);
      lmUpdate.payee = payeeName;
    }

    if (Object.keys(lmUpdate).length === 0) {
      throw new BlueplateError("No valid corrections found.", "NO_CORRECTIONS", false);
    }

    // Update in LM
    await this.lm.rawClient.updateTransaction(record.lm_transaction_id, lmUpdate);

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
    logger.info("Transaction amended", { lmId: record.lm_transaction_id, lmUpdate });

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

    // If part of a split group, undo all legs
    const records = record.split_group_id != null
      ? this.db.getByGroupId(record.split_group_id)
      : [record];

    await Promise.all(records.map((r) => this.undoSingleRecord(r)));

    return {
      payee: record.payee,
      amount: records.reduce((s, r) => s + r.amount, 0),
      currency: record.currency,
    };
  }

  private async undoSingleRecord(record: TransactionRow): Promise<void> {
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
