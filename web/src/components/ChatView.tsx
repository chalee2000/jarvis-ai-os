import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { charCount, MESSAGE_MAX_CHARS, type Message, type Mode } from "../lib/api";
import { Markdown } from "./Markdown";

export interface PendingMessage {
  conversationId: string;
  clientMessageId: string;
  content: string;
  failed: boolean;
}

interface Props {
  title: string;
  mode: Mode;
  messages: Message[];
  loading: boolean;
  pending: PendingMessage | null;
  sending: boolean;
  error: { message: string; retry?: () => void } | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onDismissError: () => void;
  onRetryUnanswered: (messageId: string) => void;
}

// Fictional example prompts (no real personal data).
const SAMPLE_PROMPTS = [
  "ช่วยวางแผนงานสัปดาห์นี้ให้หน่อย มีรายงาน 1 ฉบับและประชุม 2 ครั้ง",
  "สรุปข้อดีข้อเสียของการทำงานแบบไฮบริดสั้น ๆ",
  "ร่างข้อความขอบคุณ “ทีมฟ้าคราม” หลังจบโครงการตัวอย่าง",
  "อธิบายความต่างระหว่างข้อเท็จจริงกับข้อสันนิษฐาน",
];

function sourceLabel(message: Message): string {
  if (message.source === "mock") return "คำตอบจำลอง";
  if (message.source === "seed") return "ข้อมูลตัวอย่าง";
  return message.model ? `Claude · ${message.model}` : "Claude";
}

export function ChatView(props: Props) {
  const { messages, pending, sending, error, draft, loading } = props;
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const count = charCount(draft);
  const tooLong = count > MESSAGE_MAX_CHARS;
  const canSend = draft.trim().length > 0 && !tooLong && !sending;

  const answered = useMemo(
    () => new Set(messages.filter((m) => m.replyTo).map((m) => m.replyTo)),
    [messages],
  );
  const last = messages[messages.length - 1];
  const unansweredLatest =
    last && last.role === "user" && !answered.has(last.id) && !sending && !pending ? last : null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending, sending]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl/Cmd + Enter sends; plain Enter adds a new line (mobile-friendly).
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (canSend) props.onSend();
    }
  }

  const isEmpty = !loading && messages.length === 0 && !pending;

  return (
    <main className="chat" aria-label="แชตกับ JARVIS">
      <h2 className="chat-title" title={props.title}>{props.title}</h2>

      <div className="messages" aria-live="polite" aria-busy={sending}>
        {loading && <p className="muted center pad">กำลังโหลดข้อความ…</p>}

        {isEmpty && (
          <div className="empty-state">
            <span className="brand-mark large" aria-hidden="true" />
            <h3>สวัสดีครับ ผมคือ JARVIS</h3>
            <p className="muted">
              {props.mode === "mock"
                ? "ขณะนี้อยู่ในโหมดจำลอง คำตอบเป็นข้อความตัวอย่าง แต่ประวัติจะถูกบันทึกจริง"
                : "พิมพ์คำถามได้เลย ผมจะแยกข้อเท็จจริงกับข้อสันนิษฐานให้ชัดเจน"}
            </p>
            <ul className="samples">
              {SAMPLE_PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    className="sample-btn"
                    onClick={() => {
                      props.onDraftChange(prompt);
                      inputRef.current?.focus();
                    }}
                  >
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((message) => (
          <article key={message.id} className={`bubble ${message.role}`}>
            {message.role === "assistant" ? (
              <>
                <Markdown text={message.content} />
                <footer className="bubble-meta">
                  <span>{sourceLabel(message)}</span>
                  {message.truncated && <span className="warn">คำตอบถูกตัดเพราะถึงขีดจำกัด 1,024 tokens</span>}
                </footer>
              </>
            ) : (
              <>
                <p className="plain">{message.content}</p>
                {unansweredLatest?.id === message.id && !error && (
                  <footer className="bubble-meta">
                    <span className="warn">ยังไม่ได้รับคำตอบ</span>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => props.onRetryUnanswered(message.id)}
                    >
                      ลองใหม่
                    </button>
                  </footer>
                )}
              </>
            )}
          </article>
        ))}

        {pending && (
          <article className={`bubble user${pending.failed ? " failed" : " pending"}`}>
            <p className="plain">{pending.content}</p>
            <footer className="bubble-meta">
              <span>{pending.failed ? "ส่งไม่สำเร็จ" : "กำลังส่ง…"}</span>
            </footer>
          </article>
        )}

        {sending && (
          <div className="typing" role="status">
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            JARVIS กำลังตอบ…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <p>{error.message}</p>
          <div className="error-actions">
            {error.retry && (
              <button type="button" className="btn btn-primary btn-small" onClick={error.retry} disabled={sending}>
                ลองใหม่
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-small" onClick={props.onDismissError}>
              ปิด
            </button>
          </div>
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) props.onSend();
        }}
      >
        <label htmlFor="composer-input" className="visually-hidden">
          ข้อความถึง JARVIS
        </label>
        <textarea
          id="composer-input"
          ref={inputRef}
          rows={1}
          placeholder="พิมพ์ข้อความถึง JARVIS…"
          value={draft}
          onChange={(e) => props.onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-describedby="composer-count"
          aria-invalid={tooLong}
        />
        <div className="composer-row">
          <span id="composer-count" className={`count${tooLong ? " over" : ""}`}>
            {count.toLocaleString("en-US")}/{MESSAGE_MAX_CHARS.toLocaleString("en-US")}
          </span>
          <span className="muted small hint">Ctrl/⌘ + Enter เพื่อส่ง</span>
          <button type="submit" className="btn btn-primary" disabled={!canSend}>
            {sending ? "กำลังตอบ…" : "ส่ง"}
          </button>
        </div>
      </form>
    </main>
  );
}
