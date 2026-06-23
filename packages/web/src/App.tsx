import { useEffect, useMemo, useState } from "react";
import { LoginScreen } from "./auth/LoginScreen";
import { loadToken, saveToken, clearToken } from "./auth/token-store";
import { createApiClient, ApiError } from "./api/client";
import { API_BASE_URL } from "./config";
import { useStore } from "./store/store";
import { AppLayout } from "./AppLayout";
import { SessionList } from "./session/SessionList";
import { wireStateForSession } from "./session/status";
import { NewSessionWizard } from "./session/NewSessionWizard";
import { loadRecentDirs } from "./picker/recents";
import { ChatView } from "./chat/ChatView";

type Phase = "login" | "validating" | "ready";

export function App() {
  const [token, setTokenState] = useState<string | undefined>(() => loadToken());
  const [phase, setPhase] = useState<Phase>(token === undefined ? "login" : "validating");
  const [loginError, setLoginError] = useState<string | undefined>();
  const { sessions, setSessions, setToken, activeSessionId, setActive, views } = useStore();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  const api = useMemo(
    () => createApiClient({ baseUrl: API_BASE_URL, getToken: () => (token === "" ? undefined : token) }),
    [token],
  );

  useEffect(() => {
    if (token === undefined) return;
    setToken(token);
    let cancelled = false;
    setPhase("validating");
    api
      .listSessions()
      .then((s) => {
        if (cancelled) return;
        setSessions(s);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          setTokenState(undefined);
          setLoginError("Invalid token (401). Check the access token and try again.");
          setPhase("login");
        } else {
          // network/other error: still enter the app; the list is empty and can be retried.
          setPhase("ready");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, api, setSessions, setToken]);

  if (phase === "login" || token === undefined) {
    return (
      <LoginScreen
        initialError={loginError}
        onAuthenticated={(t) => {
          saveToken(t);
          setLoginError(undefined);
          setTokenState(t);
        }}
      />
    );
  }

  if (phase === "validating") {
    return <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-muted)" }}>Connecting…</div>;
  }

  const list = (
    <SessionList
      sessions={sessions}
      activeId={activeSessionId}
      onSelect={(id) => {
        setActive(id);
        setSessionsOpen(false);
      }}
      onNew={() => setWizardOpen(true)}
      viewWireState={(id) => wireStateForSession(sessions.find((s) => s.id === id) ?? { id, cwd: "", dangerouslySkip: false, status: "running", createdAt: 0 }, views[id])}
    />
  );

  return (
    <>
      <AppLayout
        sessionList={list}
        sessionsOpen={sessionsOpen}
        onShowSessions={() => setSessionsOpen(true)}
        onHideSessions={() => setSessionsOpen(false)}
      >
        {activeSessionId ? (
          (() => {
            const active = sessions.find((s) => s.id === activeSessionId);
            return active ? (
              <ChatView session={active} api={api} token={token} />
            ) : (
              <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-muted)" }}>Session not found.</div>
            );
          })()
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-muted)", padding: "var(--sp-5)" }}>Select or start a session.</div>
        )}
      </AppLayout>
      {wizardOpen && (
        <NewSessionWizard
          api={api}
          recents={loadRecentDirs()}
          onClose={() => setWizardOpen(false)}
          onCreated={(session) => {
            setSessions([...sessions, session]);
            setActive(session.id);
            setWizardOpen(false);
            setSessionsOpen(false);
          }}
        />
      )}
    </>
  );
}
