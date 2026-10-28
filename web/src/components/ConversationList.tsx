import type { Conversation } from "../lib/api";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (conversation: Conversation) => void;
}

const dateFormat = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" });

export function ConversationList({ conversations, activeId, loading, onSelect, onCreate, onDelete }: Props) {
  return (
    <nav className="conversation-nav" aria-label="รายการบทสนทนา">
      <button type="button" className="btn btn-primary btn-block" onClick={onCreate}>
        + บทสนทนาใหม่
      </button>
      {loading && <p className="muted small pad">กำลังโหลด…</p>}
      {!loading && conversations.length === 0 && (
        <p className="muted small pad">ยังไม่มีบทสนทนา เริ่มพิมพ์เพื่อสร้างบทสนทนาแรก</p>
      )}
      <ul className="conversation-list">
        {conversations.map((c) => (
          <li key={c.id} className={c.id === activeId ? "active" : undefined}>
            <button
              type="button"
              className="conversation-item"
              aria-current={c.id === activeId ? "page" : undefined}
              onClick={() => onSelect(c.id)}
            >
              <span className="conversation-title">{c.title}</span>
              <span className="conversation-date">{dateFormat.format(new Date(c.updatedAt))}</span>
            </button>
            <button
              type="button"
              className="icon-btn delete-btn"
              aria-label={`ลบบทสนทนา ${c.title}`}
              title="ลบบทสนทนา"
              onClick={() => onDelete(c)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z"
                />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
