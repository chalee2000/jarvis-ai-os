import type { HistoryMessage } from "./context.js";

export type ProviderSource = "mock" | "claude";

export interface GeneratedReply {
  text: string;
  model: string;
  truncated: boolean;
}

export interface ChatProvider {
  readonly source: ProviderSource;
  generate(history: HistoryMessage[]): Promise<GeneratedReply>;
}

export type ProviderErrorKind =
  | "rate_limited"
  | "timeout"
  | "connection"
  | "auth"
  | "bad_request"
  | "unavailable"
  | "refusal"
  | "empty";

/** A failure from the AI provider. Never converted into a mock reply. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly details: { status?: number; retryAfterSeconds?: number; requestId?: string } = {},
  ) {
    super(`provider_error:${kind}`);
    this.name = "ProviderError";
  }
}
