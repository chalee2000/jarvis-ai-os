import { useState, type FormEvent } from "react";
import { api, ApiError, type Mode, type SessionInfo } from "../lib/api";
import { ModeBadge } from "./ModeBadge";

interface Props {
  mode: Mode;
  notice: string | null;
  onLoggedIn: (session: SessionInfo) => void;
}

export function LoginScreen({ mode, notice, onLoggedIn }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await api.login(username.trim(), password);
      setPassword("");
      onLoggedIn(session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
      setSubmitting(false);
    }
  }

  return (
    <main className="center-screen login-screen">
      <form className="card login-card" onSubmit={handleSubmit} noValidate>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>JARVIS V1</h1>
            <p className="muted">Personal AI Command Center</p>
          </div>
        </div>
        <ModeBadge mode={mode} />

        {notice && <p className="notice" role="status">{notice}</p>}

        <label className="field">
          <span>ชื่อผู้ใช้</span>
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={64}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span>รหัสผ่าน</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <p className="error-text" role="alert">{error}</p>}

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={submitting || !username.trim() || !password}
        >
          {submitting ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
        <p className="muted small">
          แอปส่วนตัวสำหรับผู้ใช้คนเดียว ไม่มีการสมัครสมาชิก — ผู้ดูแลสร้างบัญชีผ่าน terminal
        </p>
      </form>
    </main>
  );
}
