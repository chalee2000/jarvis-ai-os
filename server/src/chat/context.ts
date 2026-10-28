export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Conservative token estimate without a network call: non-ASCII characters
 * (e.g. Thai) are counted as one token each, ASCII as one token per 3 chars,
 * plus a small per-message overhead.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3) + other + 4;
}

/**
 * Keeps the most recent messages that fit within the token budget. The newest
 * message is always kept, and the result always starts with a user turn.
 */
export function selectContext(messages: HistoryMessage[], budget: number): HistoryMessage[] {
  const selected: HistoryMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    const cost = estimateTokens(message.content);
    if (selected.length > 0 && used + cost > budget) break;
    selected.unshift(message);
    used += cost;
  }
  while (selected.length > 0 && selected[0]!.role !== "user") selected.shift();
  return selected;
}
