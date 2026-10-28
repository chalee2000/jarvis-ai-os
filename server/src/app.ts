import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import "./types.js";
import type { AppConfig } from "./config.js";
import type { Db } from "./db/pool.js";
import type { ChatProvider } from "./chat/provider.js";
import { ChatService } from "./chat/service.js";
import type { Logger } from "./logger.js";
import { apiNotFound, errorHandler, requestLogger } from "./middleware/errors.js";
import { chatRateLimit, defaultRateLimits, loginRateLimit, type RateLimitSettings } from "./middleware/rate-limits.js";
import { csrfProtection, securityHeaders } from "./middleware/security.js";
import { loadSession } from "./middleware/session.js";
import { authRouter } from "./routes/auth.js";
import { conversationsRouter } from "./routes/conversations.js";
import { healthRouter } from "./routes/health.js";

export interface AppDeps {
  config: AppConfig;
  db: Db;
  provider: ChatProvider;
  log: Logger;
  rateLimits?: RateLimitSettings;
}

export function createApp({ config, db, provider, log, rateLimits = defaultRateLimits }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  // Render terminates TLS at its proxy; trust only the configured number of hops.
  app.set("trust proxy", config.trustProxyHops);

  app.use(securityHeaders(config));
  app.use(requestLogger(log));
  app.use(healthRouter(db));

  const chat = new ChatService({
    db,
    provider,
    contextTokenBudget: config.contextTokenBudget,
    log,
  });

  const api = express.Router();
  api.use(cookieParser());
  api.use(express.json({ limit: "24kb" }));
  api.use(loadSession(config, db));
  api.use(csrfProtection(config));
  api.use(
    "/auth",
    authRouter({ config, db, log, loginLimiter: loginRateLimit(rateLimits) }),
  );
  api.use("/conversations", conversationsRouter({ chat, chatLimiter: chatRateLimit(rateLimits) }));
  api.use(apiNotFound);
  app.use("/api", api);

  // Built React app (single origin). Missing in dev, where Vite serves it.
  const indexHtml = path.join(config.clientDistDir, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(
      "/assets",
      express.static(path.join(config.clientDistDir, "assets"), {
        immutable: true,
        maxAge: "1y",
        index: false,
        fallthrough: false,
      }),
    );
    app.use(express.static(config.clientDistDir, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler(log));
  return app;
}
