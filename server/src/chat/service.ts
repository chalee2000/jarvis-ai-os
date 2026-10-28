import type { Db } from "../db/pool.js";
import { HttpError, notFound } from "../http-error.js";
import type { Logger } from "../logger.js";
import { selectContext, type HistoryMessage } from "./context.js";
import { ProviderError, type ChatProvider, type ProviderErrorKind } from "./provider.js";

export const DEFAULT_CONVERSATION_TITLE = "บทสนทนาใหม่";
const TITLE_MAX_CHARS = 40;

export interface ConversationDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  replyTo: string | null;
  source: string | null;
  model: string | null;
  truncated: boolean;
  createdAt: string;
}

interface MessageRow {
  id: string;
  seq: string;
  role: "user" | "assistant";
  content: string;
  reply_to: string | null;
  source: string | null;
  model: string | null;
  truncated: boolean;
  created_at: Date;
}

interface ConversationRow {
  id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

const MESSAGE_COLUMNS = "id, seq, role, content, reply_to, source, model, truncated, created_at";

const PROVIDER_ERRORS: Record<
  ProviderErrorKind,
  { status: number; message: string; retryable: boolean }
> = {
  rate_limited: {
    status: 429,
    message: "Claude API แจ้งว่ามีคำขอมากเกินไป (429) กรุณารอสักครู่แล้วกด “ลองใหม่”",
    retryable: true,
  },
  timeout: {
    status: 504,
    message: "Claude API ตอบช้าเกินเวลาที่กำหนด กรุณากด “ลองใหม่”",
    retryable: true,
  },
  connection: {
    status: 502,
    message: "เชื่อมต่อ Claude API ไม่สำเร็จ กรุณากด “ลองใหม่”",
    retryable: true,
  },
  auth: {
    status: 502,
    message: "Claude API ปฏิเสธการยืนยันตัวตน ผู้ดูแลระบบต้องตรวจสอบ ANTHROPIC_API_KEY",
    retryable: false,
  },
  bad_request: {
    status: 502,
    message: "Claude API ไม่รับคำขอนี้ ผู้ดูแลระบบควรตรวจสอบค่า ANTHROPIC_MODEL",
    retryable: false,
  },
  unavailable: {
    status: 503,
    message: "Claude API ไม่พร้อมให้บริการชั่วคราว กรุณาลองใหม่ภายหลัง",
    retryable: true,
  },
  refusal: {
    status: 422,
    message: "Claude ปฏิเสธที่จะตอบคำขอนี้ ลองปรับถ้อยคำแล้วส่งใหม่",
    retryable: false,
  },
  empty: {
    status: 502,
    message: "Claude API ไม่ได้ส่งข้อความตอบกลับ (อาจใช้ token ครบ 1,024 ก่อนตอบ) กรุณากด “ลองใหม่”",
    retryable: true,
  },
};

function toConversationDto(row: ConversationRow): ConversationDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toMessageDto(row: MessageRow): MessageDto {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    replyTo: row.reply_to,
    source: row.source,
    model: row.model,
    truncated: row.truncated,
    createdAt: row.created_at.toISOString(),
  };
}

export function titleFromMessage(content: string): string {
  const chars = [...content.replace(/\s+/g, " ").trim()];
  const title = chars.length > TITLE_MAX_CHARS ? `${chars.slice(0, TITLE_MAX_CHARS).join("")}…` : chars.join("");
  return title || DEFAULT_CONVERSATION_TITLE;
}

export interface ChatServiceOptions {
  db: Db;
  provider: ChatProvider;
  contextTokenBudget: number;
  log: Logger;
}

/**
 * Conversation and message operations. Every method takes the authenticated
 * user's id and only touches conversations owned by that user.
 */
export class ChatService {
  private readonly busy = new Set<string>();

  constructor(private readonly options: ChatServiceOptions) {}

  private get db(): Db {
    return this.options.db;
  }

  async listConversations(userId: string): Promise<ConversationDto[]> {
    const { rows } = await this.db.query<ConversationRow>(
      `SELECT id, title, created_at, updated_at FROM conversations
        WHERE user_id = $1 ORDER BY updated_at DESC, created_at DESC LIMIT 200`,
      [userId],
    );
    return rows.map(toConversationDto);
  }

  async createConversation(userId: string, title?: string): Promise<ConversationDto> {
    const { rows } = await this.db.query<ConversationRow>(
      `INSERT INTO conversations (user_id, title) VALUES ($1, $2)
       RETURNING id, title, created_at, updated_at`,
      [userId, title?.trim() || DEFAULT_CONVERSATION_TITLE],
    );
    return toConversationDto(rows[0]!);
  }

  async getConversation(userId: string, conversationId: string): Promise<ConversationDto> {
    const { rows } = await this.db.query<ConversationRow>(
      `SELECT id, title, created_at, updated_at FROM conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    if (!rows[0]) throw notFound();
    return toConversationDto(rows[0]);
  }

  async listMessages(userId: string, conversationId: string): Promise<MessageDto[]> {
    await this.getConversation(userId, conversationId);
    const { rows } = await this.db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = $1 ORDER BY seq`,
      [conversationId],
    );
    return rows.map(toMessageDto);
  }

  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    const result = await this.db.query(
      "DELETE FROM conversations WHERE id = $1 AND user_id = $2",
      [conversationId, userId],
    );
    if (result.rowCount === 0) throw notFound();
  }

  /**
   * Stores the user message (idempotent per clientMessageId) and generates a
   * reply. If generation fails the user message stays stored and the error
   * carries its id so the client can retry without storing it again.
   */
  async sendMessage(
    userId: string,
    conversationId: string,
    content: string,
    clientMessageId: string,
  ): Promise<{ userMessage: MessageDto; assistantMessage: MessageDto }> {
    await this.getConversation(userId, conversationId);
    return this.withConversationLock(conversationId, async () => {
      const userMessage = await this.insertUserMessage(conversationId, content, clientMessageId);
      return this.answer(conversationId, userMessage);
    });
  }

  /** Generates a reply for an existing, unanswered latest user message. */
  async retry(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<{ userMessage: MessageDto; assistantMessage: MessageDto }> {
    await this.getConversation(userId, conversationId);
    return this.withConversationLock(conversationId, async () => {
      const { rows } = await this.db.query<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages
          WHERE id = $1 AND conversation_id = $2 AND role = 'user'`,
        [messageId, conversationId],
      );
      const userMessage = rows[0];
      if (!userMessage) throw notFound();

      const existing = await this.findReply(userMessage.id);
      if (existing) return { userMessage: toMessageDto(userMessage), assistantMessage: existing };

      const latest = await this.db.query<{ id: string }>(
        `SELECT id FROM messages WHERE conversation_id = $1 AND role = 'user'
          ORDER BY seq DESC LIMIT 1`,
        [conversationId],
      );
      if (latest.rows[0]?.id !== userMessage.id) {
        throw new HttpError(409, "not_latest", "ลองใหม่ได้เฉพาะข้อความล่าสุดของบทสนทนา");
      }
      return this.answer(conversationId, userMessage);
    });
  }

  private async withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(conversationId)) {
      throw new HttpError(
        409,
        "busy",
        "JARVIS กำลังตอบข้อความก่อนหน้าในบทสนทนานี้ กรุณารอสักครู่",
        { retryable: true },
      );
    }
    this.busy.add(conversationId);
    try {
      return await fn();
    } finally {
      this.busy.delete(conversationId);
    }
  }

  private async insertUserMessage(
    conversationId: string,
    content: string,
    clientMessageId: string,
  ): Promise<MessageRow> {
    const inserted = await this.db.query<MessageRow>(
      `INSERT INTO messages (conversation_id, role, content, client_message_id)
       VALUES ($1, 'user', $2, $3)
       ON CONFLICT (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL
       DO NOTHING
       RETURNING ${MESSAGE_COLUMNS}`,
      [conversationId, content, clientMessageId],
    );
    if (inserted.rows[0]) {
      await this.db.query(
        `UPDATE conversations
            SET updated_at = now(),
                title = CASE
                  WHEN title = $2 AND NOT EXISTS (
                    SELECT 1 FROM messages
                     WHERE conversation_id = $1 AND role = 'user' AND id <> $4
                  ) THEN $3
                  ELSE title
                END
          WHERE id = $1`,
        [conversationId, DEFAULT_CONVERSATION_TITLE, titleFromMessage(content), inserted.rows[0].id],
      );
      return inserted.rows[0];
    }
    // Same clientMessageId sent again (e.g. network retry): reuse the stored message.
    const existing = await this.db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages
        WHERE conversation_id = $1 AND client_message_id = $2`,
      [conversationId, clientMessageId],
    );
    return existing.rows[0]!;
  }

  private async findReply(userMessageId: string): Promise<MessageDto | undefined> {
    const { rows } = await this.db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE reply_to = $1`,
      [userMessageId],
    );
    return rows[0] ? toMessageDto(rows[0]) : undefined;
  }

  private async answer(
    conversationId: string,
    userMessage: MessageRow,
  ): Promise<{ userMessage: MessageDto; assistantMessage: MessageDto }> {
    const existing = await this.findReply(userMessage.id);
    if (existing) return { userMessage: toMessageDto(userMessage), assistantMessage: existing };

    // History of this conversation only, up to and including this user message.
    const history = await this.db.query<HistoryMessage>(
      `SELECT role, content FROM messages
        WHERE conversation_id = $1 AND seq <= $2 ORDER BY seq`,
      [conversationId, userMessage.seq],
    );
    const context = selectContext(history.rows, this.options.contextTokenBudget);

    const { provider, log } = this.options;
    let reply;
    try {
      reply = await provider.generate(context);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      log.warn("provider_error", {
        kind: err.kind,
        status: err.details.status,
        requestId: err.details.requestId,
        conversationId,
      });
      const mapped = PROVIDER_ERRORS[err.kind];
      throw new HttpError(mapped.status, `provider_${err.kind}`, mapped.message, {
        retryable: mapped.retryable,
        messageId: userMessage.id,
        retryAfterSeconds: err.details.retryAfterSeconds,
      });
    }

    const inserted = await this.db.query<MessageRow>(
      `INSERT INTO messages (conversation_id, role, content, reply_to, source, model, truncated)
       VALUES ($1, 'assistant', $2, $3, $4, $5, $6)
       ON CONFLICT (reply_to) WHERE reply_to IS NOT NULL DO NOTHING
       RETURNING ${MESSAGE_COLUMNS}`,
      [conversationId, reply.text, userMessage.id, provider.source, reply.model, reply.truncated],
    );
    await this.db.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [conversationId]);
    const assistantMessage = inserted.rows[0]
      ? toMessageDto(inserted.rows[0])
      : (await this.findReply(userMessage.id))!;
    return { userMessage: toMessageDto(userMessage), assistantMessage };
  }
}
