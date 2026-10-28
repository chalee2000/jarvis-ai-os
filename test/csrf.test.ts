import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPreSessionCsrfToken } from "../server/src/auth/csrf.js";
import type { Db } from "../server/src/db/pool.js";
import { buildApp, createUser, del, freshDatabase, login, ORIGIN, PASSWORD, post, preLoginCsrf, truncateAll } from "./helpers.js";

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

describe("CSRF protection", () => {
  it("rejects state-changing requests without a CSRF token", async () => {
    const app = buildApp(db);
    const session = await login(app, "owner");
    const res = await session.agent.post("/api/conversations").set("Origin", ORIGIN).send({}).expect(403);
    expect(res.body.error.code).toBe("forbidden");
    const { rows } = await db.query("SELECT 1 FROM conversations");
    expect(rows).toHaveLength(0);
  });

  it("rejects a wrong CSRF token", async () => {
    const app = buildApp(db);
    const session = await login(app, "owner");
    await session.agent
      .post("/api/conversations")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", "not-the-right-token")
      .send({})
      .expect(403);
  });

  it("rejects a foreign or missing Origin even with a valid token", async () => {
    const app = buildApp(db);
    const session = await login(app, "owner");
    await session.agent
      .post("/api/conversations")
      .set("Origin", "https://evil.example")
      .set("X-CSRF-Token", session.csrf)
      .send({})
      .expect(403);
    await session.agent.post("/api/conversations").set("X-CSRF-Token", session.csrf).send({}).expect(403);
    // A same-origin Referer is accepted when Origin is absent.
    await session.agent
      .post("/api/conversations")
      .set("Referer", `${ORIGIN}/chat`)
      .set("X-CSRF-Token", session.csrf)
      .send({})
      .expect(201);
  });

  it("requires JSON bodies", async () => {
    const app = buildApp(db);
    const session = await login(app, "owner");
    await session.agent
      .post("/api/conversations")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", session.csrf)
      .set("Content-Type", "text/plain")
      .send("title=x")
      .expect(415);
  });

  it("protects DELETE and logout", async () => {
    const app = buildApp(db);
    const session = await login(app, "owner");
    const created = await post(session, "/api/conversations").expect(201);
    const id = created.body.conversation.id as string;
    await session.agent.delete(`/api/conversations/${id}`).set("Origin", ORIGIN).expect(403);
    await session.agent.post("/api/auth/logout").set("Origin", ORIGIN).send({}).expect(403);
    await del(session, `/api/conversations/${id}`).expect(204);
  });

  it("protects login with a signed double-submit token", async () => {
    const app = buildApp(db);
    const agent = request.agent(app);
    await preLoginCsrf(agent);
    // No header
    await agent.post("/api/auth/login").set("Origin", ORIGIN).send({ username: "owner", password: PASSWORD }).expect(403);
    // Token signed with another secret
    const forged = createPreSessionCsrfToken("another-secret-another-secret-123456");
    await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .set("Cookie", `jarvis_csrf=${forged}`)
      .set("X-CSRF-Token", forged)
      .send({ username: "owner", password: PASSWORD })
      .expect(403);
    const { rows } = await db.query("SELECT 1 FROM sessions");
    expect(rows).toHaveLength(0);
  });

  it("does not require a CSRF token for reads", async () => {
    const app = buildApp(db);
    const session = await login(app, "owner");
    await session.agent.get("/api/conversations").expect(200);
  });
});

describe("request limits and headers", () => {
  it("rejects bodies over 24kb", async () => {
    const app = buildApp(db);
    const session = await login(app, "owner");
    const created = await post(session, "/api/conversations").expect(201);
    const res = await post(session, `/api/conversations/${created.body.conversation.id}/messages`, {
      content: "ก".repeat(9000),
      clientMessageId: "00000000-0000-4000-8000-000000000000",
    }).expect(413);
    expect(res.body.error.code).toBe("payload_too_large");
  });

  it("sends security headers and no stack traces", async () => {
    const app = buildApp(db);
    const res = await request(app).get("/api/does-not-exist").expect(404);
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/at .+\.(ts|js):\d+/);
  });

  it("healthz reveals nothing but status", async () => {
    const app = buildApp(db);
    const res = await request(app).get("/healthz").expect(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
