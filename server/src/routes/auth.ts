import { Router, type RequestHandler } from "express";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/pool.js";
import { createPreSessionCsrfToken, isValidPreSessionCsrfToken, preSessionCsrfCookieName } from "../auth/csrf.js";
import { dummyVerify, verifyPassword } from "../auth/password.js";
import { createSession, destroySessionByHash, purgeExpiredSessions } from "../auth/sessions.js";
import { HttpError } from "../http-error.js";
import type { Logger } from "../logger.js";
import { clearSessionCookie, requireAuth, sessionCookieOptions, setSessionCookie } from "../middleware/session.js";
import { loginSchema, parseBody } from "./validation.js";

export function authRouter(deps: {
  config: AppConfig;
  db: Db;
  log: Logger;
  loginLimiter: RequestHandler;
}): Router {
  const { config, db, log, loginLimiter } = deps;
  const router = Router();
  const preCookie = preSessionCsrfCookieName(config.isProduction);
  const mode = config.mockMode ? "mock" : "claude";

  router.get("/session", (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.auth) {
      res.json({
        authenticated: true,
        user: { username: req.auth.username },
        csrfToken: req.auth.csrfToken,
        mode,
      });
      return;
    }
    let token: unknown = req.cookies?.[preCookie];
    if (typeof token !== "string" || !isValidPreSessionCsrfToken(config.sessionSecret, token)) {
      token = createPreSessionCsrfToken(config.sessionSecret);
      res.cookie(preCookie, token, { ...sessionCookieOptions(config), sameSite: "strict" });
    }
    res.json({ authenticated: false, csrfToken: token, mode });
  });

  router.post("/login", loginLimiter, async (req, res) => {
    const { username, password } = parseBody(loginSchema, req.body);
    const { rows } = await db.query<{ id: string; username: string; password_hash: string }>(
      "SELECT id, username, password_hash FROM users WHERE username = $1",
      [username],
    );
    const user = rows[0];
    const ok = user ? await verifyPassword(user.password_hash, password) : await dummyVerify(password);
    if (!user || !ok) {
      log.warn("login_failed");
      throw new HttpError(401, "invalid_credentials", "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    }

    // Session fixation defence: drop any existing session and issue a new id.
    if (req.auth) await destroySessionByHash(db, req.auth.sessionIdHash);
    await purgeExpiredSessions(db);
    const session = await createSession(db, config.sessionSecret, user.id);
    await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);

    setSessionCookie(res, config, session.token);
    res.clearCookie(preCookie, { ...sessionCookieOptions(config), sameSite: "strict" });
    log.info("login_succeeded");
    res.set("Cache-Control", "no-store");
    res.json({
      authenticated: true,
      user: { username: user.username },
      csrfToken: session.csrfToken,
      mode,
    });
  });

  router.post("/logout", requireAuth, async (req, res) => {
    await destroySessionByHash(db, req.auth!.sessionIdHash);
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  return router;
}
