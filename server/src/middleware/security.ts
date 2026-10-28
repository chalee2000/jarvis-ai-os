import helmet from "helmet";
import type { RequestHandler } from "express";
import type { AppConfig } from "../config.js";
import {
  CSRF_HEADER,
  isValidPreSessionCsrfToken,
  preSessionCsrfCookieName,
  safeEqual,
} from "../auth/csrf.js";
import { forbidden, HttpError } from "../http-error.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function securityHeaders(config: AppConfig): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: config.isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
    referrerPolicy: { policy: "same-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
  });
}

/**
 * CSRF defence for state-changing requests:
 *  1. Origin (or Referer) must match APP_ORIGIN.
 *  2. Body must be JSON (forces a CORS preflight for cross-site senders).
 *  3. X-CSRF-Token must match the session's token, or — before login — the
 *     signed double-submit cookie.
 */
export function csrfProtection(config: AppConfig): RequestHandler {
  const allowed = new Set(config.appOrigins);
  const preCookie = preSessionCsrfCookieName(config.isProduction);

  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get("origin") ?? originFromReferer(req.get("referer"));
    if (!origin || !allowed.has(origin)) {
      throw forbidden("คำขอถูกปฏิเสธ: แหล่งที่มาของคำขอไม่ถูกต้อง");
    }

    if (["POST", "PUT", "PATCH"].includes(req.method) && !req.is("application/json")) {
      throw new HttpError(415, "unsupported_media_type", "รองรับเฉพาะข้อมูลแบบ JSON");
    }

    const headerToken = req.get(CSRF_HEADER);
    if (!headerToken) throw forbidden("คำขอถูกปฏิเสธ: ไม่มี CSRF token");

    if (req.auth) {
      if (!safeEqual(headerToken, req.auth.csrfToken)) {
        throw forbidden("คำขอถูกปฏิเสธ: CSRF token ไม่ถูกต้อง กรุณารีเฟรชหน้า");
      }
    } else {
      const cookieToken: unknown = req.cookies?.[preCookie];
      if (
        typeof cookieToken !== "string" ||
        !safeEqual(headerToken, cookieToken) ||
        !isValidPreSessionCsrfToken(config.sessionSecret, cookieToken)
      ) {
        throw forbidden("คำขอถูกปฏิเสธ: CSRF token ไม่ถูกต้อง กรุณารีเฟรชหน้า");
      }
    }
    next();
  };
}

function originFromReferer(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
