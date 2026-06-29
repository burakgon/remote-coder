import { useRef } from "react";
import type { CSSProperties } from "react";
import { Icon } from "../ui/Icon";
import { useFocusTrap } from "../ui/useFocusTrap";
import { ClaudeAuthSection } from "./ClaudeAuthSection";
import type { ApiClient } from "../api/client";

/**
 * A focused modal for Claude sign-in — the SAME flow as Settings → "Claude sign-in", just surfaced
 * directly. Opened by the `/login` slash command and by the "Sign in" button on a 401 auth-error turn, so
 * a user whose server login expired can fix it without hunting through Settings. The actual flow is the
 * reused {@link ClaudeAuthSection} (no duplicate login logic).
 */
export function ClaudeAuthDialog({ api, onClose }: { api: ApiClient; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref as React.RefObject<HTMLElement>, true);
  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={BACKDROP}
    >
      <div
        ref={ref}
        className="rc-glass--float"
        role="dialog"
        aria-modal="true"
        aria-label="Claude sign-in"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        style={SHEET}
      >
        <div style={HEADER}>
          <span aria-hidden style={{ display: "inline-flex", color: "var(--coral)" }}>
            <Icon name="terminal" size={18} />
          </span>
          <span style={TITLE}>Claude sign-in</span>
          <button type="button" onClick={onClose} aria-label="Close" style={CLOSE_BTN}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <ClaudeAuthSection api={api} />
      </div>
    </div>
  );
}

const BACKDROP: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  display: "grid",
  placeItems: "end center",
  padding: "var(--sp-4)",
  paddingBottom: "max(var(--sp-4), env(safe-area-inset-bottom))",
  background: "var(--scrim, rgba(0,0,0,0.45))",
};

const SHEET: CSSProperties = {
  width: "min(480px, 100%)",
  maxHeight: "calc(100dvh - 2 * var(--sp-4))",
  overflowY: "auto",
  borderRadius: "var(--radius)",
  padding: "var(--sp-4)",
  display: "grid",
  gap: "var(--sp-3)",
  animation: "rc-rise 0.28s ease-out",
};

const HEADER: CSSProperties = { display: "flex", alignItems: "center", gap: "var(--sp-2)" };

const TITLE: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: "var(--fs-lg, var(--fs-base))",
  color: "var(--text)",
};

const CLOSE_BTN: CSSProperties = {
  marginLeft: "auto",
  width: "var(--tap-min)",
  height: "var(--tap-min)",
  flex: "none",
  display: "grid",
  placeItems: "center",
  background: "transparent",
  border: 0,
  color: "var(--text-muted)",
  cursor: "pointer",
};
