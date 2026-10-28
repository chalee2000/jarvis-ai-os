import Anthropic from "@anthropic-ai/sdk";
import type { HistoryMessage } from "./context.js";
import { JARVIS_SYSTEM_PROMPT } from "./system-prompt.js";
import { ProviderError, type ChatProvider, type GeneratedReply } from "./provider.js";

export const MAX_OUTPUT_TOKENS = 1024;
export const REQUEST_TIMEOUT_MS = 45_000;

// Models that accept server-side refusal fallbacks with `fallbacks: "default"`.
const FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** `output_config.effort` is accepted by the Claude 5 family and Opus 4.5+/Sonnet 4.6. */
export function supportsEffort(model: string): boolean {
  const family = /^claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)/.exec(model);
  if (family && Number(family[1]) >= 5) return true;
  return /^claude-(?:opus-4-[5-8]|sonnet-4-6)/.test(model);
}

export function supportsRefusalFallback(model: string): boolean {
  return FALLBACK_MODELS.has(model);
}

export interface ClaudeProviderOptions {
  apiKey: string;
  model: string;
  /** Injected in tests; defaults to a real SDK client. */
  client?: Pick<Anthropic, "beta">;
}

export function createClaudeProvider(options: ClaudeProviderOptions): ChatProvider {
  const client =
    options.client ??
    new Anthropic({ apiKey: options.apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
  const { model } = options;

  return {
    source: "claude",
    async generate(history: HistoryMessage[]): Promise<GeneratedReply> {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: JARVIS_SYSTEM_PROMPT,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          // Opus 5.5 cannot disable thinking; low effort keeps chat replies
          // well within the 1,024-token output cap.
          ...(supportsEffort(model) ? { output_config: { effort: "low" as const } } : {}),
          ...(supportsRefusalFallback(model)
            ? { betas: [FALLBACK_BETA], fallbacks: "default" as const }
            : {}),
        });
      } catch (err) {
        throw toProviderError(err);
      }

      if (response.stop_reason === "refusal") {
        throw new ProviderError("refusal", { requestId: response.id });
      }
      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
      if (!text) throw new ProviderError("empty", { requestId: response.id });

      return {
        text,
        // The model that actually answered (may differ after a refusal fallback).
        model: response.model,
        truncated:
          response.stop_reason === "max_tokens" ||
          response.stop_reason === "model_context_window_exceeded",
      };
    },
  };
}

function retryAfterSeconds(headers: Headers | undefined): number | undefined {
  const value = headers?.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

/** Maps SDK errors (most specific first) to provider error kinds. */
export function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout");
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("connection");
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError("rate_limited", {
      status: 429,
      retryAfterSeconds: retryAfterSeconds(err.headers),
      requestId: err.requestID ?? undefined,
    });
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("auth", { status: err.status, requestId: err.requestID ?? undefined });
  }
  if (
    err instanceof Anthropic.BadRequestError ||
    err instanceof Anthropic.NotFoundError ||
    err instanceof Anthropic.UnprocessableEntityError
  ) {
    return new ProviderError("bad_request", { status: err.status, requestId: err.requestID ?? undefined });
  }
  if (err instanceof Anthropic.APIError) {
    return new ProviderError("unavailable", {
      status: typeof err.status === "number" ? err.status : undefined,
      requestId: err.requestID ?? undefined,
    });
  }
  return new ProviderError("connection");
}
