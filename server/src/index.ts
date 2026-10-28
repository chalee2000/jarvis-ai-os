import { createApp } from "./app.js";
import { ConfigError, loadConfig, type AppConfig } from "./config.js";
import { createClaudeProvider } from "./chat/claude-provider.js";
import { createMockProvider } from "./chat/mock-provider.js";
import type { ChatProvider } from "./chat/provider.js";
import { pendingMigrations } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { logger } from "./logger.js";

function createProvider(config: AppConfig): ChatProvider {
  if (config.mockMode) return createMockProvider();
  return createClaudeProvider({ apiKey: config.anthropicApiKey!, model: config.anthropicModel! });
}

async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const db = createPool(config.databaseUrl);
  db.on("error", (err) => logger.error("db_pool_error", { name: err.name }));

  const pending = await pendingMigrations(db);
  if (pending.length > 0) {
    console.error(`ฐานข้อมูลยังไม่ได้ migrate (${pending.join(", ")}) — รัน "npm run migrate" ก่อน`);
    await db.end();
    process.exit(1);
  }

  const app = createApp({ config, db, provider: createProvider(config), log: logger });
  const server = app.listen(config.port, config.host, () => {
    logger.info("server_started", {
      host: config.host,
      port: config.port,
      env: config.nodeEnv,
      mode: config.mockMode ? "mock" : "claude",
    });
  });

  const purgeTimer = setInterval(() => {
    purgeExpiredSessions(db).catch(() => logger.warn("session_purge_failed"));
  }, 60 * 60 * 1000);
  purgeTimer.unref();

  const shutdown = (signal: string) => {
    logger.info("shutdown", { signal });
    clearInterval(purgeTimer);
    server.close(() => {
      db.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.error("startup_failed", { name: err instanceof Error ? err.name : typeof err });
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
