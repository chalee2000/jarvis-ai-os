import { useCallback, useEffect, useState } from "react";
import { api, ApiError, setCsrfToken, type SessionInfo } from "./lib/api";
import { LoginScreen } from "./components/LoginScreen";
import { ChatApp } from "./components/ChatApp";

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const applySession = useCallback((info: SessionInfo) => {
    setCsrfToken(info.csrfToken);
    setSession(info);
  }, []);

  const loadSession = useCallback(async () => {
    setLoadError(null);
    try {
      applySession(await api.session());
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    }
  }, [applySession]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const handleSignedOut = useCallback(
    (message?: string) => {
      setNotice(message ?? null);
      setSession(null);
      setCsrfToken(null);
      void loadSession();
    },
    [loadSession],
  );

  if (loadError) {
    return (
      <main className="center-screen">
        <div className="card">
          <p role="alert" className="error-text">{loadError}</p>
          <button type="button" className="btn btn-primary" onClick={() => void loadSession()}>
            ลองใหม่
          </button>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="center-screen" aria-busy="true">
        <p className="muted">กำลังโหลด JARVIS…</p>
      </main>
    );
  }

  if (!session.authenticated || !session.user) {
    return (
      <LoginScreen
        mode={session.mode}
        notice={notice}
        onLoggedIn={(info) => {
          setNotice(null);
          applySession(info);
        }}
      />
    );
  }

  return <ChatApp username={session.user.username} mode={session.mode} onSignedOut={handleSignedOut} />;
}
