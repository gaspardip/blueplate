import type { Context, NextFunction } from "grammy";
import { logger } from "../logger.js";

export function authGuard(allowedChatIds: number[]) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    if (allowedChatIds.length === 0) {
      await next();
      return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId || !allowedChatIds.includes(chatId)) {
      logger.warn("Unauthorized access attempt", { chatId });
      await ctx.reply("Unauthorized.");
      return;
    }

    await next();
  };
}

export function errorBoundary() {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    try {
      await next();
    } catch (error) {
      const chatId = ctx.chat?.id;
      const messageId = ctx.message?.message_id;

      logger.error("Unhandled error in bot", {
        chatId,
        messageId,
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      try {
        await ctx.reply(`Error: ${error instanceof Error ? error.message : String(error)}`);
      } catch {
        // Failed to send error message, nothing we can do
      }
    }
  };
}

export function requestLogger() {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text;

    logger.debug("Incoming message", { chatId, text });
    await next();
  };
}
