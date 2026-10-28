import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, newClientMessageId, type Conversation, type Message, type Mode } from "../lib/api";
import { ChatView, type PendingMessage } from "./ChatView";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConversationList } from "./ConversationList";
import { ModeBadge } from "./ModeBadge";

interface Props {
  username: string;
  mode: Mode;
  onSignedOut: (message?: string) => void;
}

interface ChatError {
  message: string;
  retry?: () => void;
}

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const known = new Set(current.map((m) => m.id));
  return [...current, ...incoming.filter((m) => !known.has(m.id))];
}

export function ChatApp({ username, mode, onSignedOut }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [draft, setDraft] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  /** Returns true when the error means the session is gone. */
  const handleAuthError = useCallback(
    (err: unknown): boolean => {
      if (err instanceof ApiError && err.status === 401) {
        onSignedOut("เซสชันหมดอายุหรือถูกเพิกถอน กรุณาเข้าสู่ระบบอีกครั้ง");
        return true;
      }
      return false;
    },
    [onSignedOut],
  );

  const errorMessage = (err: unknown) =>
    err instanceof ApiError ? err.message : "เกิดข้อผิดพลาด กรุณาลองใหม่";

  const refreshConversations = useCallback(async () => {
    try {
      const { conversations } = await api.listConversations();
      setConversations(conversations);
      return conversations;
    } catch (err) {
      if (!handleAuthError(err)) setError({ message: errorMessage(err) });
      return null;
    } finally {
      setListLoading(false);
    }
  }, [handleAuthError]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      setMessagesLoading(true);
      try {
        const result = await api.listMessages(conversationId);
        if (activeRef.current === conversationId) setMessages(result.messages);
      } catch (err) {
        if (!handleAuthError(err)) setError({ message: errorMessage(err) });
      } finally {
        if (activeRef.current === conversationId) setMessagesLoading(false);
      }
    },
    [handleAuthError],
  );

  useEffect(() => {
    void refreshConversations().then((list) => {
      if (list && list[0] && activeRef.current === null) {
        setActiveId(list[0].id);
        void loadMessages(list[0].id);
      }
    });
  }, [refreshConversations, loadMessages]);

  function selectConversation(id: string) {
    setDrawerOpen(false);
    if (id === activeId) return;
    setActiveId(id);
    activeRef.current = id;
    setMessages([]);
    setPending(null);
    setError(null);
    void loadMessages(id);
  }

  async function createConversation(): Promise<string | null> {
    try {
      const { conversation } = await api.createConversation();
      setConversations((prev) => [conversation, ...prev]);
      setActiveId(conversation.id);
      activeRef.current = conversation.id;
      setMessages([]);
      setPending(null);
      setError(null);
      setDrawerOpen(false);
      return conversation.id;
    } catch (err) {
      if (!handleAuthError(err)) setError({ message: errorMessage(err) });
      return null;
    }
  }

  async function retryStored(conversationId: string, messageId: string) {
    setSending(true);
    setError(null);
    try {
      const result = await api.retryMessage(conversationId, messageId);
      if (activeRef.current === conversationId) {
        setMessages((prev) => mergeMessages(prev, [result.userMessage, result.assistantMessage]));
      }
      void refreshConversations();
    } catch (err) {
      if (handleAuthError(err)) return;
      setError({ message: errorMessage(err), retry: () => void retryStored(conversationId, messageId) });
    } finally {
      setSending(false);
    }
  }

  async function deliver(message: PendingMessage) {
    setPending(message);
    setSending(true);
    setError(null);
    try {
      const result = await api.sendMessage(message.conversationId, message.content, message.clientMessageId);
      if (activeRef.current === message.conversationId) {
        setMessages((prev) => mergeMessages(prev, [result.userMessage, result.assistantMessage]));
      }
      setPending(null);
      void refreshConversations();
    } catch (err) {
      if (handleAuthError(err)) return;
      const apiError = err instanceof ApiError ? err : null;
      if (apiError?.messageId) {
        // The server stored the message but could not answer: retry the stored
        // message instead of sending it again.
        const storedId = apiError.messageId;
        setPending(null);
        await loadMessages(message.conversationId);
        void refreshConversations();
        setError({
          message: apiError.message,
          retry: () => void retryStored(message.conversationId, storedId),
        });
      } else if (apiError && apiError.status === 400) {
        setPending(null);
        setDraft(message.content);
        setError({ message: apiError.message });
      } else {
        // Unknown whether it was stored: resending the same clientMessageId is
        // idempotent on the server, so it can never create a duplicate.
        setPending({ ...message, failed: true });
        setError({ message: errorMessage(err), retry: () => void deliver(message) });
      }
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    const content = draft;
    if (!content.trim() || sending) return;
    const conversationId = activeId ?? (await createConversation());
    if (!conversationId) return;
    setDraft("");
    await deliver({ conversationId, clientMessageId: newClientMessageId(), content, failed: false });
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteConversation(toDelete.id);
      const remaining = conversations.filter((c) => c.id !== toDelete.id);
      setConversations(remaining);
      if (toDelete.id === activeId) {
        const next = remaining[0]?.id ?? null;
        setActiveId(next);
        activeRef.current = next;
        setMessages([]);
        setPending(null);
        setError(null);
        if (next) void loadMessages(next);
      }
      setToDelete(null);
    } catch (err) {
      if (!handleAuthError(err)) {
        setToDelete(null);
        setError({ message: errorMessage(err) });
      }
    } finally {
      setDeleting(false);
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
      onSignedOut("ออกจากระบบเรียบร้อยแล้ว");
    } catch (err) {
      if (!handleAuthError(err)) setError({ message: errorMessage(err) });
    }
  }

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className={`app-shell${drawerOpen ? " drawer-open" : ""}`}>
      <header className="topbar">
        <button
          type="button"
          className="icon-btn menu-btn"
          aria-label="เปิดรายการบทสนทนา"
          aria-expanded={drawerOpen}
          aria-controls="sidebar"
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path fill="currentColor" d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" />
          </svg>
        </button>
        <div className="brand compact">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">JARVIS</span>
        </div>
        <ModeBadge mode={mode} />
        <div className="topbar-spacer" />
        <span className="username" title="ผู้ใช้ที่เข้าสู่ระบบ">{username}</span>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => void handleLogout()}>
          ออกจากระบบ
        </button>
      </header>

      <aside id="sidebar" className="sidebar">
        <div className="sidebar-header">
          <span>บทสนทนา</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="ปิดรายการบทสนทนา"
            onClick={() => setDrawerOpen(false)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                fill="currentColor"
                d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z"
              />
            </svg>
          </button>
        </div>
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          loading={listLoading}
          onSelect={selectConversation}
          onCreate={() => void createConversation()}
          onDelete={setToDelete}
        />
      </aside>
      <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />

      <ChatView
        title={activeConversation?.title ?? "บทสนทนาใหม่"}
        mode={mode}
        messages={messages}
        loading={messagesLoading}
        pending={pending && pending.conversationId === activeId ? pending : null}
        sending={sending}
        error={error}
        draft={draft}
        onDraftChange={setDraft}
        onSend={() => void handleSend()}
        onDismissError={() => setError(null)}
        onRetryUnanswered={(messageId) => activeId && void retryStored(activeId, messageId)}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title="ลบบทสนทนา?"
        message={`ต้องการลบ “${toDelete?.title ?? ""}” และข้อความทั้งหมดในบทสนทนานี้หรือไม่ การลบไม่สามารถย้อนกลับได้`}
        confirmLabel="ลบบทสนทนา"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
