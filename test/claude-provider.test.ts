import http from "node:http";
import type { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  createClaudeProvider,
  MAX_OUTPUT_TOKENS,
  supportsEffort,
  supportsRefusalFallback,
} from "../server/src/chat/claude-provider.js";
import { estimateTokens, selectContext, type HistoryMessage } from "../server/src/chat/context.js";
import { ProviderError } from "../server/src/chat/provider.js";

const HISTORY: HistoryMessage[] = [{ role: "user", content: "สวัสดี JARVIS" }];

function messageResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: "สวัสดีครับ" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

/** Local stand-in for the Messages API so the real SDK can be exercised offline. */
let server: http.Server | undefined;
let lastRequest: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> } | undefined;

async function startFakeApi(
  handler: (res: http.ServerResponse) => void,
): Promise<string> {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      lastRequest = { headers: req.headers, body: raw ? JSON.parse(raw) : {} };
      handler(res);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  lastRequest = undefined;
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  }
});

function providerFor(baseURL: string, model = "claude-opus-5-5", timeout = 2000) {
  const client = new Anthropic({ apiKey: "test-key-not-real", baseURL, timeout, maxRetries: 0 });
  return createClaudeProvider({ apiKey: "unused", model, client });
}

function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

describe("Claude provider request", () => {
  it("sends the configured model, 1,024 max tokens, the Thai system prompt and the history", async () => {
    const baseURL = await startFakeApi((res) => json(res, 200, messageResponse()));
    const reply = await providerFor(baseURL).generate(HISTORY);
    expect(reply).toEqual({ text: "สวัสดีครับ", model: "claude-opus-5-5", truncated: false });

    const body = lastRequest!.body;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS).toBe(1024);
    expect(String(body.system)).toContain("ภาษาไทย");
    expect(String(body.system)).toContain("ข้อสันนิษฐาน");
    expect(body.messages).toEqual([{ role: "user", content: "สวัสดี JARVIS" }]);
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.fallbacks).toBe("default");
    expect(lastRequest!.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(body).not.toHaveProperty("temperature");
  });

  it("omits effort and fallbacks for models that do not support them", async () => {
    const baseURL = await startFakeApi((res) => json(res, 200, messageResponse({ model: "claude-haiku-4-5" })));
    await providerFor(baseURL, "claude-haiku-4-5").generate(HISTORY);
    expect(lastRequest!.body).not.toHaveProperty("output_config");
    expect(lastRequest!.body).not.toHaveProperty("fallbacks");
    expect(supportsEffort("claude-sonnet-5-5")).toBe(true);
    expect(supportsRefusalFallback("claude-haiku-5-5")).toBe(false);
  });

  it("marks replies cut by max_tokens as truncated", async () => {
    const baseURL = await startFakeApi((res) => json(res, 200, messageResponse({ stop_reason: "max_tokens" })));
    const reply = await providerFor(baseURL).generate(HISTORY);
    expect(reply.truncated).toBe(true);
  });
});

describe("Claude provider errors (never silently mocked)", () => {
  async function expectKind(promise: Promise<unknown>, kind: string) {
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe(kind);
    return err as ProviderError;
  }

  it("maps 429 to rate_limited with Retry-After", async () => {
    const baseURL = await startFakeApi((res) =>
      json(res, 429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, { "retry-after": "12" }),
    );
    const err = await expectKind(providerFor(baseURL).generate(HISTORY), "rate_limited");
    expect(err.details.retryAfterSeconds).toBe(12);
  });

  it("maps a slow response to timeout", async () => {
    const baseURL = await startFakeApi(() => {
      /* never respond */
    });
    await expectKind(providerFor(baseURL, "claude-opus-5-5", 200).generate(HISTORY), "timeout");
  });

  it("maps 401 to auth, 400 to bad_request and 529 to unavailable", async () => {
    let status = 401;
    const baseURL = await startFakeApi((res) =>
      json(res, status, { type: "error", error: { type: "api_error", message: "x" } }),
    );
    await expectKind(providerFor(baseURL).generate(HISTORY), "auth");
    status = 400;
    await expectKind(providerFor(baseURL).generate(HISTORY), "bad_request");
    status = 529;
    await expectKind(providerFor(baseURL).generate(HISTORY), "unavailable");
  });

  it("treats a refusal or an empty answer as an error", async () => {
    let body = messageResponse({ stop_reason: "refusal", content: [] });
    const baseURL = await startFakeApi((res) => json(res, 200, body));
    await expectKind(providerFor(baseURL).generate(HISTORY), "refusal");
    body = messageResponse({ content: [] });
    await expectKind(providerFor(baseURL).generate(HISTORY), "empty");
  });

  it("maps an unreachable API to connection", async () => {
    await expectKind(providerFor("http://127.0.0.1:9").generate(HISTORY), "connection");
  });
});

describe("context budget", () => {
  it("keeps the newest messages within budget and starts with a user turn", () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "ก".repeat(500) },
      { role: "assistant", content: "ข".repeat(500) },
      { role: "user", content: "ค".repeat(500) },
      { role: "assistant", content: "ง".repeat(500) },
      { role: "user", content: "คำถามล่าสุด" },
    ];
    const selected = selectContext(history, 1100);
    expect(selected[0]!.role).toBe("user");
    expect(selected.at(-1)!.content).toBe("คำถามล่าสุด");
    expect(selected.reduce((n, m) => n + estimateTokens(m.content), 0)).toBeLessThanOrEqual(1100);
    expect(selected.length).toBeLessThan(history.length);
  });

  it("always keeps the newest message even if it exceeds the budget", () => {
    const selected = selectContext([{ role: "user", content: "ก".repeat(4000) }], 1000);
    expect(selected).toHaveLength(1);
  });
});
