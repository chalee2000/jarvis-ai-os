import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError, notFound } from "../http-error.js";
import type { Logger } from "../logger.js";

export const apiNotFound: RequestHandler = () => {
  throw notFound();
};

/** Converts errors into JSON without exposing stack traces or internals. */
export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (res.headersSent) return;

    if (err instanceof HttpError) {
      if (err.extra.retryAfterSeconds !== undefined) {
        res.set("Retry-After", String(err.extra.retryAfterSeconds));
      }
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          retryable: err.extra.retryable ?? false,
          ...(err.extra.messageId ? { messageId: err.extra.messageId } : {}),
        },
      });
      return;
    }

    // body-parser errors
    const type = (err as { type?: string }).type;
    if (type === "entity.too.large") {
      res.status(413).json({ error: { code: "payload_too_large", message: "ข้อมูลที่ส่งมีขนาดใหญ่เกินไป" } });
      return;
    }
    if (type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "invalid_json", message: "รูปแบบข้อมูลไม่ถูกต้อง" } });
      return;
    }

    // Other client errors raised by Express/serve-static (e.g. missing asset).
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      res.status(status).json({ error: { code: "client_error", message: "คำขอไม่ถูกต้อง" } });
      return;
    }

    log.error("unhandled_error", {
      method: req.method,
      path: req.originalUrl.split("?")[0],
      name: err instanceof Error ? err.name : typeof err,
      pgCode: (err as { code?: string }).code,
    });
    res.status(500).json({
      error: { code: "internal_error", message: "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง" },
    });
  };
}

export function requestLogger(log: Logger): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      log.info("request", {
        method: req.method,
        // Path only: no query string, headers or bodies.
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      });
    });
    next();
  };
}
