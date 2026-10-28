import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProviderError, type ChatProvider } from "../server/src/chat/provider.js";
import type { HistoryMessage } from "../server/src/chat/context.js";
import type { Db } from "../server/src/db/pool.js";
import { buildApp, createUser, del, freshDatabase, login, post, truncateAll } from "./helpers.js";

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
  await createUser(db, "intruder");
});

async function countMessages(conversationId: string, role?: string) {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM messages WHERE conversation_id = $1 ${role ? "AND role = $2" : ""}`,
    role ? [conversationId, role] : [conversationId],
  );
  return Number(rows[0]!.n);
}

describe("conversation ownership", () => {
  it("never lets another user read, send to, retry or delete a conversation", async () => {
    const app = buildApp(db);
    const owner = await login(app, "owner");
    const intruder = await login(app, "intruder");

    const created = await post(owner, "/api/conversations", { title: "แผนส่วนตัว" }).expect(201);
    const id = created.body.conversation.id as string;
    const sent = await post(owner, `/api/conversations/${id}/messages`, {
      content: "ข้อความลับของเจ้าของ",
      clientMessageId: randomUUID(),
    }).expect(201);
    const userMessageId = sent.body.userMessage.id as string;

    const list = await intruder.agent.get("/api/conversations").expect(200);
    expect(list.body.conversations).toEqual([]);

    const read = await intruder.agent.get(`/api/conversations/${id}/messages`).expect(404);
    expect(JSON.stringify(read.body)).not.toContain("ข้อความลับ");
    await post(intruder, `/api/conversations/${id}/messages`, {
      content: "แอบส่ง",
      clientMessageId: randomUUID(),
    }).expect(404);
    await post(intruder, `/api/conversations/${id}/messages/${userMessageId}/retry`).expect(404);
    await del(intruder, `/api/conversations/${id}`).expect(404);

    expect(await countMessages(id)).toBe(2);
    await owner.agent.get(`/api/conversations/${id}/messages`).expect(200);
  });

  it("treats malformed ids as not found", async () => {
    const app = buildApp(db);
    const owner = await login(app, "owner");
    await owner.agent.get("/api/conversations/not-a-uuid/messages").expect(404);
    await del(owner, "/api/conversations/1%20OR%201=1").expect(404);
  });
});

describe("chat in mock mode", () => {
  it("stores the question and the mock answer in PostgreSQL", async () => {
    const app = buildApp(db);
    const owner = await login(app, "owner");
    const created = await post(owner, "/api/conversations").expect(201);
    const id = created.body.conversation.id as string;
    expect(created.body.conversation.title).toBe("บทสนทนาใหม่");

    const res = await post(owner, `/api/conversations/${id}/messages`, {
      content: "ช่วยวางแผนวันหยุดสมมติให้หน่อย",
      clientMessageId: randomUUID(),
    }).expect(201);
    expect(res.body.userMessage).toMatchObject({ role: "user", content: "ช่วยวางแผนวันหยุดสมมติให้หน่อย" });
    expect(res.body.assistantMessage).toMatchObject({
      role: "assistant",
      source: "mock",
      model: "jarvis-mock-v1",
      replyTo: res.body.userMessage.id,
    });
    expect(res.body.assistantMessage.content).toContain("คำตอบจำลอง");

    const history = await owner.agent.get(`/api/conversations/${id}/messages`).expect(200);
    expect(history.body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(history.body.conversation.title).toBe("ช่วยวางแผนวันหยุดสมมติให้หน่อย");
  });

  it("keeps history after a restart (new app instance, same database)", async () => {
    const first = buildApp(db);
    const owner = await login(first, "owner");
    const created = await post(owner, "/api/conversations").expect(201);
    const id = created.body.conversation.id as string;
    await post(owner, `/api/conversations/${id}/messages`, {
      content: "จำข้อความนี้ไว้",
      clientMessageId: randomUUID(),
    }).expect(201);

    const restarted = buildApp(db);
    const again = await login(restarted, "owner");
    const history = await again.agent.get(`/api/conversations/${id}/messages`).expect(200);
    expect(history.body.messages).toHaveLength(2);
    expect(history.body.messages[0].content).toBe("จำข้อความนี้ไว้");
  });

  it("does not store a message twice when the same clientMessageId is resent", async () => {
    const app = buildApp(db);
    const owner = await login(app, "owner");
    const created = await post(owner, "/api/conversations").expect(201);
    const id = created.body.conversation.id as string;
    const body = { content: "ส่งซ้ำได้ไหม", clientMessageId: randomUUID() };
    const first = await post(owner, `/api/conversations/${id}/messages`, body).expect(201);
    const second = await post(owner, `/api/conversations/${id}/messages`, body).expect(201);
    expect(second.body.userMessage.id).toBe(first.body.userMessage.id);
    expect(second.body.assistantMessage.id).toBe(first.body.assistantMessage.id);
    expect(await countMessages(id)).toBe(2);
  });

  it("validates message length and content", async () => {
    const app = buildApp(db);
    const owner = await login(app, "owner");
    const created = await post(owner, "/api/conversations").expect(201);
    const url = `/api/conversations/${created.body.conversation.id}/messages`;
    await post(owner, url, { content: "ก".repeat(4000), clientMessageId: randomUUID() }).expect(201);
    const tooLong = await post(owner, url, { content: "ก".repeat(4001), clientMessageId: randomUUID() }).expect(400);
    expect(tooLong.body.error.message).toContain("4,000");
    await post(owner, url, { content: "   ", clientMessageId: randomUUID() }).expect(400);
    await post(owner, url, { content: "ok", clientMessageId: "not-a-uuid" }).expect(400);
    await post(owner, url, { content: 123, clientMessageId: randomUUID() }).expect(400);
  });

  it("deletes a conversation together with its messages", async () => {
    const app = buildApp(db);
    const owner = await login(app, "owner");
    const created = await post(owner, "/api/conversations").expect(201);
    const id = created.body.conversation.id as string;
    await post(owner, `/api/conversations/${id}/messages`, { content: "ลบฉัน", clientMessageId: randomUUID() }).expect(201);
    await del(owner, `/api/conversations/${id}`).expect(204);
    expect(await countMessages(id)).toBe(0);
    await owner.agent.get(`/api/conversations/${id}/messages`).expect(404);
  });
});

/** A provider that fails until `healthy` is set, recording what it was sent. */
function flakyProvider() {
  const state = { healthy: false, calls: [] as HistoryMessage[][] };
  const provider: ChatProvider = {
    source: "claude",
    async generate(history) {
      state.calls.push(history);
      if (!state.healthy) throw new ProviderError("rate_limited", { status: 429, retryAfterSeconds: 7 });
      return { text: "คำตอบจริงหลังลองใหม่", model: "claude-test", truncated: false };
    },
  };
  return { state, provider };
}

describe("provider failures and retry", () => {
  it("returns a clear 429, keeps the user message and never stores a mock reply", async () => {
    const { state, provider } = flakyProvider();
    const app = buildApp(db, { provider, config: { mockMode: false } });
    const owner = await login(app, "owner");
    const created = await post(owner, "/api/conversations").expect(201);
    const id = created.body.conversation.id as string;

    const failed = await post(owner, `/api/conversations/${id}/messages`, {
      content: "คำถามที่จะล้มเหลว",
      clientMessageId: randomUUID(),
    }).expect(429);
    expect(failed.headers["retry-after"]).toBe("7");
    expect(failed.body.error).toMatchObject({ code: "provider_rate_limited", retryable: true });
    const messageId = failed.body.error.messageId as string;
    expect(await countMessages(id, "user")).toBe(1);
    expect(await countMessages(id, "assistant")).toBe(0);

    state.healthy = true;
    const retried = await post(owner, `/api/conversations/${id}/messages/${messageId}/retry`).expect(200);
    expect(retried.body.userMessage.id).toBe(messageId);
    expect(retried.body.assistantMessage).toMatchObject({ content: "คำตอบจริงหลังลองใหม่", source: "claude" });
    expect(await countMessages(id, "user")).toBe(1);
    expect(await countMessages(id, "assistant")).toBe(1);

    // Retrying an answered message returns the stored reply without calling the provider.
    const callsBefore = state.calls.length;
    await post(owner, `/api/conversations/${id}/messages/${messageId}/retry`).expect(200);
    expect(state.calls.length).toBe(callsBefore);
  });

  it("only sends this conversation's history to the provider", async () => {
    const { state, provider } = flakyProvider();
    state.healthy = true;
    const app = buildApp(db, { provider, config: { mockMode: false } });
    const owner = await login(app, "owner");
    const intruder = await login(app, "intruder");

    const other = await post(intruder, "/api/conversations").expect(201);
    await post(intruder, `/api/conversations/${other.body.conversation.id}/messages`, {
      content: "ข้อความของผู้ใช้อื่น",
      clientMessageId: randomUUID(),
    }).expect(201);

    const ownerCallsStart = state.calls.length;
    const mine = await post(owner, "/api/conversations").expect(201);
    const id = mine.body.conversation.id as string;
    await post(owner, `/api/conversations/${id}/messages`, { content: "ข้อแรก", clientMessageId: randomUUID() }).expect(201);
    await post(owner, `/api/conversations/${id}/messages`, { content: "ข้อสอง", clientMessageId: randomUUID() }).expect(201);

    const lastCall = state.calls.at(-1)!;
    expect(lastCall.map((m) => m.content)).toEqual(["ข้อแรก", "คำตอบจริงหลังลองใหม่", "ข้อสอง"]);
    expect(JSON.stringify(state.calls.slice(ownerCallsStart))).not.toContain("ข้อความของผู้ใช้อื่น");
  });

  it("refuses to retry a message that is not the latest", async () => {
    const { state, provider } = flakyProvider();
    const app = buildApp(db, { provider, config: { mockMode: false } });
    const owner = await login(app, "owner");
    const created = await post(owner, "/api/conversations").expect(201);
    const id = created.body.conversation.id as string;
    const first = await post(owner, `/api/conversations/${id}/messages`, {
      content: "ข้อความแรก",
      clientMessageId: randomUUID(),
    }).expect(429);
    state.healthy = true;
    await post(owner, `/api/conversations/${id}/messages`, { content: "ข้อความถัดไป", clientMessageId: randomUUID() }).expect(201);
    const res = await post(owner, `/api/conversations/${id}/messages/${first.body.error.messageId}/retry`).expect(409);
    expect(res.body.error.code).toBe("not_latest");
  });
});
