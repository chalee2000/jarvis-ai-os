export type Mode = "mock" | "claude";

export interface SessionInfo {
  authenticated: boolean;
  user?: { username: string };
  csrfToken: string;
  mode: Mode;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  replyTo: string | null;
  source: string | null;
  model: string | null;
  truncated: boolean;
  createdAt: string;
}

export interface ChatResult {
  userMessage: Message;
  assistantMessage: Message;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly messageId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The CSRF token lives in memory only (never localStorage). Session cookies are HttpOnly.
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function request<T>(method: "GET" | "POST" | "DELETE", url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
    if (method === "POST") headers["Content-Type"] = "application/json";
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "same-origin",
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่", true);
  }
  if (response.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = (data as { error?: Record<string, unknown> } | null)?.error ?? {};
    throw new ApiError(
      response.status,
      typeof error.code === "string" ? error.code : "error",
      typeof error.message === "string" ? error.message : "เกิดข้อผิดพลาด กรุณาลองใหม่",
      error.retryable === true,
      typeof error.messageId === "string" ? error.messageId : undefined,
    );
  }
  return data as T;
}

export const api = {
  session: () => request<SessionInfo>("GET", "/api/auth/session"),
  login: (username: string, password: string) =>
    request<SessionInfo>("POST", "/api/auth/login", { username, password }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  listConversations: () =>
    request<{ conversations: Conversation[] }>("GET", "/api/conversations"),
  createConversation: () =>
    request<{ conversation: Conversation }>("POST", "/api/conversations", {}),
  deleteConversation: (id: string) => request<void>("DELETE", `/api/conversations/${id}`),
  listMessages: (id: string) =>
    request<{ conversation: Conversation; messages: Message[] }>(
      "GET",
      `/api/conversations/${id}/messages`,
    ),
  sendMessage: (id: string, content: string, clientMessageId: string) =>
    request<ChatResult>("POST", `/api/conversations/${id}/messages`, { content, clientMessageId }),
  retryMessage: (id: string, messageId: string) =>
    request<ChatResult>("POST", `/api/conversations/${id}/messages/${messageId}/retry`, {}),
};

/** Idempotency key for a new message (randomUUID needs a secure context). */
export function newClientMessageId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const MESSAGE_MAX_CHARS = 4000;

export function charCount(text: string): number {
  return [...text].length;
}
