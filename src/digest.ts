import type { Bot } from "grammy";
import { logger } from "./logger.js";
import type { BlueplateDatabase } from "./storage/database.js";
import { formatDaySummary, formatWeeklySummary } from "./bot/formatters.js";
import { todayStr } from "./utils.js";

export class DailyDigest {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private bot: Bot,
    private db: BlueplateDatabase,
    private chatIds: number[],
    private hour = 22, // 10 PM local time
    private minute = 0
  ) {}

  start(): void {
    this.scheduleNext();
    logger.info("Daily digest scheduled", { hour: this.hour, minute: this.minute });
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    const now = new Date();
    const next = new Date(now);
    next.setHours(this.hour, this.minute, 0, 0);

    // If we've already passed today's time, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const delay = next.getTime() - now.getTime();
    this.timer = setTimeout(() => this.send(), delay);

    logger.debug("Next digest in", { ms: delay, at: next.toISOString() });
  }

  private async send(): Promise<void> {
    const today = todayStr();

    for (const chatId of this.chatIds) {
      try {
        const rows = this.db.getTransactionsForDate(chatId, today);
        if (rows.length === 0) {
          await this.bot.api.sendMessage(chatId, `No expenses logged today (${today}).`);
        } else {
          await this.bot.api.sendMessage(chatId, formatDaySummary(rows, today));
        }
      } catch (error) {
        logger.error("Failed to send digest", { chatId, error: String(error) });
      }
    }

    // Send weekly summary on Sundays
    if (new Date().getDay() === 0) {
      await this.sendWeekly();
    }

    // Schedule next day
    this.scheduleNext();
  }

  private async sendWeekly(): Promise<void> {
    const now = new Date();
    const weekEnd = now.toISOString().slice(0, 10);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartStr = weekStart.toISOString().slice(0, 10);

    const prevEnd = new Date(weekStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - 6);

    for (const chatId of this.chatIds) {
      try {
        const rows = this.db.getTransactionsForDateRange(chatId, weekStartStr, weekEnd);
        const prevRows = this.db.getTransactionsForDateRange(
          chatId,
          prevStart.toISOString().slice(0, 10),
          prevEnd.toISOString().slice(0, 10)
        );
        const summary = formatWeeklySummary(rows, weekStartStr, weekEnd, prevRows);
        await this.bot.api.sendMessage(chatId, summary);
      } catch (error) {
        logger.error("Failed to send weekly summary", { chatId, error: String(error) });
      }
    }
  }
}
