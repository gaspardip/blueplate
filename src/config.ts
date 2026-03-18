import { z } from "zod";

const configSchema = z.object({
  telegramBotToken: z.string().min(1),
  lunchMoneyApiKey: z.string().min(1),
  dbPath: z.string().default("./data/blueplate.db"),
  defaultCurrency: z.string().default("ARS"),
  mode: z.enum(["polling", "webhook"]).default("polling"),
  webhookUrl: z.string().optional(),
  webhookPort: z.coerce.number().default(3000),
  allowedChatIds: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => Number(s.trim()))
            .filter(Boolean)
        : []
    ),
  logLevel: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
  fxCacheTtl: z.coerce.number().default(300),
  metadataCacheTtl: z.coerce.number().default(3600),
  healthPort: z.coerce.number().default(8080),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const env = process.env;
  return configSchema.parse({
    telegramBotToken: env.BLUEPLATE_TELEGRAM_BOT_TOKEN,
    lunchMoneyApiKey: env.BLUEPLATE_LUNCHMONEY_API_KEY,
    dbPath: env.BLUEPLATE_DB_PATH,
    defaultCurrency: env.BLUEPLATE_DEFAULT_CURRENCY,
    mode: env.BLUEPLATE_MODE,
    webhookUrl: env.BLUEPLATE_WEBHOOK_URL,
    webhookPort: env.BLUEPLATE_WEBHOOK_PORT,
    allowedChatIds: env.BLUEPLATE_ALLOWED_CHAT_IDS,
    logLevel: env.BLUEPLATE_LOG_LEVEL,
    fxCacheTtl: env.BLUEPLATE_FX_CACHE_TTL,
    metadataCacheTtl: env.BLUEPLATE_METADATA_CACHE_TTL,
    healthPort: env.BLUEPLATE_HEALTH_PORT,
  });
}
