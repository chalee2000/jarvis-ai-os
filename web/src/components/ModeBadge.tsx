import type { Mode } from "../lib/api";

export function ModeBadge({ mode }: { mode: Mode }) {
  return mode === "mock" ? (
    <span className="badge badge-mock" title="ตอบด้วยข้อความจำลอง ไม่ได้เรียก Claude API">
      โหมดจำลอง
    </span>
  ) : (
    <span className="badge badge-live" title="ตอบด้วย Claude Messages API">
      Claude API
    </span>
  );
}
