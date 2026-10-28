import type { ChatProvider, GeneratedReply } from "./provider.js";
import type { HistoryMessage } from "./context.js";

export const MOCK_MODEL = "jarvis-mock-v1";

function preview(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  const chars = [...singleLine];
  return chars.length > 80 ? `${chars.slice(0, 80).join("")}…` : singleLine;
}

/** Deterministic Thai replies for MOCK_MODE=true. Never calls any external API. */
export function createMockProvider(options: { delayMs?: number } = {}): ChatProvider {
  const delayMs = options.delayMs ?? 400;
  return {
    source: "mock",
    async generate(history: HistoryMessage[]): Promise<GeneratedReply> {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const last = [...history].reverse().find((m) => m.role === "user");
      const turn = history.filter((m) => m.role === "user").length;
      const text = [
        "**(คำตอบจำลอง — ยังไม่ได้เรียก Claude API)**",
        "",
        `รับข้อความของคุณแล้ว: “${preview(last?.content ?? "")}”`,
        "",
        "**ข้อเท็จจริง**",
        `- นี่คือข้อความที่ ${turn} ในบทสนทนานี้ และถูกบันทึกลงฐานข้อมูลแล้ว`,
        "",
        "**ข้อสันนิษฐาน**",
        "- เมื่อเปิดใช้ Claude API (MOCK_MODE=false) JARVIS จะตอบตามเนื้อหาจริงของคำถาม",
      ].join("\n");
      return { text, model: MOCK_MODEL, truncated: false };
    },
  };
}
