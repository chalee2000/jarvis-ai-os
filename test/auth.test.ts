import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../server/src/db/pool.js";
import {
  buildApp,
  createUser,
  freshDatabase,
  login,
  ORIGIN,
  PASSWORD,
  post,
  preLoginCsrf,
  sessionCookie,
  truncateAll,
} from "./helpers.js";

let db: Db;

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await truncateAll(db);
  await createUser(db, "owner");
});

describe("login", () => {
  it("rejects a wrong password and an unknown user with the same message", async () => {
    const app = buildApp(db);
    const agent = request.agent(app);
    const csrf = await preLoginCsrf(agent);
    const wrong = await agent
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", csrf)
      .send({ username: "owner", password: "ผิด-ผิด-ผิด-ผิด" })
      .expect(401);
    const unknown = await agent
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", csrf)
      .send({ username: "nobody", password: PASSWORD })
      .expect(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.headers["set-cookie"]?.toString() ?? "").not.toMatch(/jarvis_sid=[^;]/);
  });

  it("logs in, sets an HttpOnly SameSite=Lax cookie and stores only a hash of the token", async () => {
    const app = buildApp(db);
    const agent = request.agent(app);
    const csrf = await preLoginCsrf(agent);
    const res = await agent
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", csrf)
      .send({ username: "Owner", password: PASSWORD })
      .expect(200);
    expect(res.body).toMatchObject({ authenticated: true, user: { username: "owner" }, mode: "mock" });

    const raw = res.headers["set-cookie"] as unknown as string[];
    const cookie = raw.find((c) => c.startsWith("jarvis_sid="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    const token = cookie.split(";")[0]!.split("=")[1]!;

    const { rows } = await db.query<{ id_hash: string; ttl_hours: number }>(
      "SELECT id_hash, EXTRACT(EPOCH FROM (expires_at - created_at)) / 3600 AS ttl_hours FROM sessions",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id_hash).not.toContain(token);
    expect(Number(rows[0]!.ttl_hours)).toBeCloseTo(24, 1);

    await agent.get("/api/conversations").expect(200);
  });

  it("issues a new session id on login and revokes the previous one", async () => {
    const app = buildApp(db);
    const first = await login(app, "owner");
    const res = await first.agent
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", first.csrf)
      .send({ username: "owner", password: PASSWORD })
      .expect(200);
    const second = sessionCookie(res.headers["set-cookie"]);
    expect(second).not.toBe(first.cookie);

    await request(app).get("/api/conversations").set("Cookie", first.cookie).expect(401);
    await request(app).get("/api/conversations").set("Cookie", second).expect(200);
    const { rows } = await db.query("SELECT 1 FROM sessions");
    expect(rows).toHaveLength(1);
  });

  it("rate limits repeated failed logins", async () => {
    const app = buildApp(db, { rateLimits: { loginMaxFailures: 3 } });
    const agent = request.agent(app);
    const csrf = await preLoginCsrf(agent);
    const attempt = () =>
      agent
        .post("/api/auth/login")
        .set("Origin", ORIGIN)
        .set("X-CSRF-Token", csrf)
        .send({ username: "owner", password: "wrong-password-123" });
    for (let i = 0; i < 3; i++) await attempt().expect(401);
    const limited = await attempt().expect(429);
    expect(limited.body.error.code).toBe("rate_limited");
  });
});

describe("logout and session lifetime", () => {
  it("logout revokes the session on the server", async () => {
    const app = buildApp(db);
    const session = await login(app, "owner");
    await post(session, "/api/auth/logout").expect(204);
    await request(app).get("/api/conversations").set("Cookie", session.cookie).expect(401);
    const { rows } = await db.query("SELECT 1 FROM sessions");
    expect(rows).toHaveLength(0);
  });

  it("rejects and deletes an expired session", async () => {
    const app = buildApp(db);
    const session = await login(app, "owner");
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    const res = await request(app).get("/api/conversations").set("Cookie", session.cookie).expect(401);
    expect(res.body.error.code).toBe("unauthorized");
    const { rows } = await db.query("SELECT 1 FROM sessions");
    expect(rows).toHaveLength(0);
  });

  it("session endpoint reports anonymous after expiry", async () => {
    const app = buildApp(db);
    const session = await login(app, "owner");
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
    const res = await request(app).get("/api/auth/session").set("Cookie", session.cookie).expect(200);
    expect(res.body.authenticated).toBe(false);
  });
});

describe("unauthenticated access", () => {
  it("returns 401 for every conversation API", async () => {
    const app = buildApp(db);
    const agent = request.agent(app);
    const csrf = await preLoginCsrf(agent);
    const id = randomUUID();
    const withCsrf = (r: request.Test) => r.set("Origin", ORIGIN).set("X-CSRF-Token", csrf);

    await agent.get("/api/conversations").expect(401);
    await agent.get(`/api/conversations/${id}/messages`).expect(401);
    await withCsrf(agent.post("/api/conversations")).send({}).expect(401);
    await withCsrf(agent.post(`/api/conversations/${id}/messages`))
      .send({ content: "สวัสดี", clientMessageId: randomUUID() })
      .expect(401);
    await withCsrf(agent.post(`/api/conversations/${id}/messages/${randomUUID()}/retry`)).send({}).expect(401);
    await withCsrf(agent.delete(`/api/conversations/${id}`)).expect(401);
    await withCsrf(agent.post("/api/auth/logout")).send({}).expect(401);
  });
});

describe("production cookies", () => {
  it("uses __Host- prefixed Secure cookies", async () => {
    const httpsOrigin = "https://jarvis-v1-web.example.com";
    const app = buildApp(db, {
      config: { nodeEnv: "production", isProduction: true, appOrigins: [httpsOrigin], trustProxyHops: 1 },
    });
    const pre = await request(app).get("/api/auth/session").expect(200);
    const preCookie = (pre.headers["set-cookie"] as unknown as string[])[0]!;
    expect(preCookie).toMatch(/^__Host-jarvis_csrf=/);
    expect(preCookie).toMatch(/Secure/);

    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", httpsOrigin)
      .set("Cookie", preCookie.split(";")[0]!)
      .set("X-CSRF-Token", pre.body.csrfToken)
      .send({ username: "owner", password: PASSWORD })
      .expect(200);
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith("__Host-jarvis_sid="),
    )!;
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });
});
