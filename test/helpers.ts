import request from "supertest";
import type { Express } from "express";
import { createApp } from "../server/src/app.js";
import type { AppConfig } from "../server/src/config.js";
import { hashPassword } from "../server/src/auth/password.js";
import { createMockProvider } from "../server/src/chat/mock-provider.js";
import type { ChatProvider } from "../server/src/chat/provider.js";
import { runMigrations } from "../server/src/db/migrate.js";
import { createPool, type Db } from "../server/src/db/pool.js";
import { silentLogger } from "../server/src/logger.js";
import { defaultRateLimits, type RateLimitSettings } from "../server/src/middleware/rate-limits.js";

export const ORIGIN = "http://jarvis.test";
export const PASSWORD = "รหัสผ่านทดสอบยาวพอ-123";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "ต้องตั้ง TEST_DATABASE_URL (PostgreSQL สำหรับทดสอบ ข้อมูลในฐานนี้จะถูกล้าง) ก่อนรัน npm test",
    );
  }
  return url;
}

/** Drops and recreates the public schema, then applies migrations. */
export async function freshDatabase(): Promise<Db> {
  const db = createPool(testDatabaseUrl());
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(db);
  return db;
}

export async function truncateAll(db: Db): Promise<void> {
  await db.query("TRUNCATE users, sessions, conversations, messages CASCADE");
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    isProduction: false,
    host: "127.0.0.1",
    port: 0,
    databaseUrl: testDatabaseUrl(),
    sessionSecret: "test-session-secret-0123456789abcdef0123456789",
    appOrigins: [ORIGIN],
    mockMode: true,
    anthropicApiKey: undefined,
    anthropicModel: undefined,
    contextTokenBudget: 12000,
    trustProxyHops: 0,
    clientDistDir: "/nonexistent-client-dist",
    ...overrides,
  };
}

export function buildApp(
  db: Db,
  options: { config?: Partial<AppConfig>; provider?: ChatProvider; rateLimits?: Partial<RateLimitSettings> } = {},
): Express {
  return createApp({
    config: testConfig(options.config),
    db,
    provider: options.provider ?? createMockProvider({ delayMs: 0 }),
    log: silentLogger,
    rateLimits: { ...defaultRateLimits, chatMax: 1000, ...options.rateLimits },
  });
}

export async function createUser(db: Db, username: string, password = PASSWORD): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
    [username, await hashPassword(password)],
  );
  return rows[0]!.id;
}

/** Fetches the pre-login CSRF token (and cookie) for an agent. */
export async function preLoginCsrf(agent: request.Agent): Promise<string> {
  const res = await agent.get("/api/auth/session").expect(200);
  return res.body.csrfToken as string;
}

export interface LoggedIn {
  agent: request.Agent;
  csrf: string;
  cookie: string;
}

export async function login(app: Express, username: string, password = PASSWORD): Promise<LoggedIn> {
  const agent = request.agent(app);
  const pre = await preLoginCsrf(agent);
  const res = await agent
    .post("/api/auth/login")
    .set("Origin", ORIGIN)
    .set("X-CSRF-Token", pre)
    .send({ username, password })
    .expect(200);
  const cookie = sessionCookie(res.headers["set-cookie"]);
  return { agent, csrf: res.body.csrfToken as string, cookie };
}

export function sessionCookie(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const found = list.find((c) => /^(__Host-)?jarvis_sid=[^;]+/.test(c));
  if (!found) throw new Error("no session cookie");
  return found.split(";")[0]!;
}

/** POST with the headers a same-origin browser request would carry. */
export function post(session: LoggedIn, url: string, body: unknown = {}) {
  return session.agent.post(url).set("Origin", ORIGIN).set("X-CSRF-Token", session.csrf).send(body as object);
}

export function del(session: LoggedIn, url: string) {
  return session.agent.delete(url).set("Origin", ORIGIN).set("X-CSRF-Token", session.csrf);
}
