import { createHmac, randomBytes } from "node:crypto";
import type { Db } from "../db/pool.js";
import type { AuthContext } from "../types.js";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function sessionCookieName(isProduction: boolean): string {
  // The __Host- prefix forces Secure, Path=/ and no Domain in browsers.
  return isProduction ? "__Host-jarvis_sid" : "jarvis_sid";
}

export function hashSessionToken(secret: string, token: string): string {
  return createHmac("sha256", secret).update(`session:${token}`).digest("hex");
}

export interface NewSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(db: Db, secret: string, userId: string): Promise<NewSession> {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query(
    "INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at) VALUES ($1, $2, $3, $4)",
    [hashSessionToken(secret, token), userId, csrfToken, expiresAt],
  );
  return { token, csrfToken, expiresAt };
}

/** Returns the session for a token, or null. Expired sessions are deleted. */
export async function findSession(
  db: Db,
  secret: string,
  token: string,
): Promise<AuthContext | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const idHash = hashSessionToken(secret, token);
  const { rows } = await db.query<{
    user_id: string;
    username: string;
    csrf_token: string;
    expired: boolean;
  }>(
    `SELECT s.user_id, u.username, s.csrf_token, s.expires_at <= now() AS expired
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = $1`,
    [idHash],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.expired) {
    await db.query("DELETE FROM sessions WHERE id_hash = $1", [idHash]);
    return null;
  }
  return {
    userId: row.user_id,
    username: row.username,
    csrfToken: row.csrf_token,
    sessionIdHash: idHash,
  };
}

export async function destroySessionByHash(db: Db, idHash: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE id_hash = $1", [idHash]);
}

export async function destroyUserSessions(db: Db, userId: string): Promise<number> {
  const result = await db.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  return result.rowCount ?? 0;
}

export async function purgeExpiredSessions(db: Db): Promise<number> {
  const result = await db.query("DELETE FROM sessions WHERE expires_at <= now()");
  return result.rowCount ?? 0;
}
