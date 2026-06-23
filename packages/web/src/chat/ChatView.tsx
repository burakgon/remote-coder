import { useEffect, useRef } from "react";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { useStore } from "../store/store";
import { useSessionSocket } from "../session/use-session-socket";
import { wireStateForSession } from "../session/status";
import { emptyView } from "../store/frame-reducer";
import type { ApiClient } from "../api/client";
import type { SessionMeta } from "../types/server";

export interface ChatViewProps {
  session: SessionMeta;
  api: ApiClient;
  token: string | undefined;
}

export function ChatView({ session, api, token }: ChatViewProps) {
  const applyFrames = useStore((s) => s.applyFrames);
  const resetSession = useStore((s) => s.resetSession);
  const view = useStore((s) => s.views[session.id]);

  // Open the live socket (frames flow into the store via the hook).
  useSessionSocket(session, token);

  // Load REST history once per session id, replaying frames through the same reducer in a single
  // store update (one re-render). The reducer's seq-dedup makes any overlap with live frames a no-op.
  useEffect(() => {
    let cancelled = false;
    resetSession(session.id);
    api
      .getSession(session.id)
      .then(({ history }) => {
        if (cancelled) return;
        applyFrames(session.id, history);
      })
      .catch(() => {
        // history load failure is non-fatal; live frames still arrive over WS
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, api, applyFrames, resetSession]);

  const wireState = wireStateForSession(session, view);
  const safeView = view ?? emptyView();

  // Auto-scroll the log to the newest content as turns/streaming text grow — unless the user has
  // scrolled up to read history (then we leave their position alone). A small slack avoids
  // sub-pixel jitter at the bottom counting as "scrolled up".
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottom.current = distanceFromBottom < 64;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [safeView.turns.length, safeView.liveText, safeView.thinkingText]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ChatHeader session={session} wireState={wireState} />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        aria-live="polite"
        aria-relevant="additions text"
        style={{ flex: 1, overflowY: "auto" }}
      >
        <MessageList view={safeView} />
        {/* Task 7 renders the pending-permission prompt here; Task 8 adds the composer below. */}
      </div>
    </div>
  );
}
