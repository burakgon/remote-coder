import { useCallback, useEffect, useRef, useState } from "react";
import { createSessionSocket } from "../ws/session-socket";
import type { SessionSocket, SocketStatus } from "../ws/session-socket";
import { wsUrl } from "../api/client";
import { API_BASE_URL } from "../config";
import { useStore } from "../store/store";
import type { OutboundFrame, SessionMeta } from "../types/server";

export function useSessionSocket(
  session: SessionMeta,
  token: string | undefined,
  /** Gate the connection until the REST history has loaded, so the socket's `getSince` reads the
   * lastSeq (= the server's sinceSeq) ChatView just set — the first connect carries `?since=sinceSeq`
   * and the buffer isn't re-replayed over the already-rendered transcript. Defaults to true so any
   * other caller (and existing behaviour) connects immediately. */
  enabled = true,
  /** Called when the server signals a `resync` (the reconnect buffer rotated past our position): the
   *  caller should refetch the full REST history. Held in a ref so a changing identity never churns the
   *  socket effect. */
  onResync?: () => void,
): { send: (f: OutboundFrame) => boolean; status: SocketStatus } {
  const applyFrame = useStore((s) => s.applyFrame);
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const socketRef = useRef<SessionSocket | undefined>(undefined);
  const onResyncRef = useRef(onResync);
  onResyncRef.current = onResync;

  useEffect(() => {
    if (!enabled) return;
    const url = wsUrl(API_BASE_URL, session.id, { token: token || undefined });
    const socket = createSessionSocket({
      url,
      onFrame: (frame) => applyFrame(session.id, frame),
      onStatus: setStatus,
      onResync: () => onResyncRef.current?.(),
      // Reconnect delta: resume after the last applied seq for THIS session.
      getSince: () => {
        const last = useStore.getState().views[session.id]?.lastSeq ?? 0;
        return last > 0 ? last : undefined;
      },
    });
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = undefined;
    };
  }, [session.id, token, applyFrame, enabled]);

  // Stable `send` identity (reads the latest socket via the ref) so consumers' callbacks that close
  // over `send` — e.g. ChatView's `answer` and its auto-allow effect — don't churn every render.
  const send = useCallback((f: OutboundFrame) => socketRef.current?.send(f) ?? false, []);

  // FOREGROUND-GATING: tell the server whether THIS tab is visible so it suppresses a push for the session
  // the user is actively LOOKING at (and still fires for a backgrounded one / a different session). We send
  // the current state right after (re)connect — `status === "open"` — and on every visibilitychange. The
  // server defaults a fresh connection to foreground, so this is the authoritative refinement. Feature-
  // detected (`document` may be absent in non-DOM/test envs) and a no-op-safe `send` (returns false while
  // mid-reconnect; the socket queues it to flush on the next open). Only active while the socket is enabled.
  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;
    const sendVisibility = () => {
      send({ type: "visibility", state: document.visibilityState === "visible" ? "foreground" : "background" });
    };
    // Announce the current state once the socket is open (a just-(re)connected sub defaults to foreground;
    // this confirms/corrects it — e.g. if the tab is already hidden when the socket comes up).
    if (status === "open") sendVisibility();
    const onChange = () => sendVisibility();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [enabled, status, send, session.id]);

  return { send, status };
}
