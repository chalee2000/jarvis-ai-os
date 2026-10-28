import type { RequestHandler, Response } from "express";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/pool.js";
import { findSession, SESSION_TTL_MS, sessionCookieName } from "../auth/sessions.js";
import { unauthorized } from "../http-error.js";

export function sessionCookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.isProduction,
    path: "/",
  };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(sessionCookieName(config.isProduction), token, {
    ...sessionCookieOptions(config),
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
  res.clearCookie(sessionCookieName(config.isProduction), sessionCookieOptions(config));
}

/** Resolves the session cookie into req.auth. Invalid or expired cookies are cleared. */
export function loadSession(config: AppConfig, db: Db): RequestHandler {
  const cookieName = sessionCookieName(config.isProduction);
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[cookieName];
    if (typeof token !== "string" || token === "") return next();
    const auth = await findSession(db, config.sessionSecret, token);
    if (auth) req.auth = auth;
    else clearSessionCookie(res, config);
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw unauthorized();
  next();
};
