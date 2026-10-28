import { rateLimit, type Options } from "express-rate-limit";
import type { RequestHandler } from "express";

export interface RateLimitSettings {
  loginWindowMs: number;
  loginMaxFailures: number;
  chatWindowMs: number;
  chatMax: number;
}

export const defaultRateLimits: RateLimitSettings = {
  loginWindowMs: 15 * 60 * 1000,
  loginMaxFailures: 5,
  chatWindowMs: 60 * 1000,
  chatMax: 20,
};

function limitedHandler(message: string): Options["handler"] {
  return (_req, res, _next, options) => {
    res.status(options.statusCode).json({
      error: { code: "rate_limited", message, retryable: true },
    });
  };
}

// In-memory counters: correct for a single Render instance. Use a shared
// store (e.g. Redis/Postgres) before scaling to multiple instances.
export function loginRateLimit(settings: RateLimitSettings): RequestHandler {
  return rateLimit({
    windowMs: settings.loginWindowMs,
    limit: settings.loginMaxFailures,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: limitedHandler("พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่"),
  });
}

export function chatRateLimit(settings: RateLimitSettings): RequestHandler {
  return rateLimit({
    windowMs: settings.chatWindowMs,
    limit: settings.chatMax,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Mounted after requireAuth, so the user id is always present.
    keyGenerator: (req) => `user:${req.auth!.userId}`,
    handler: limitedHandler("ส่งข้อความบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่"),
  });
}
