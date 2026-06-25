import type { CSSProperties } from "react";
import { Mono } from "../ui/Mono";
import { Icon } from "../ui/Icon";
import { MobileMenuButton } from "../ui/MobileMenuButton";
import { LiveWire } from "../ui/LiveWire";
import type { LiveWireState } from "../ui/LiveWire";
import type { SessionMeta } from "../types/server";

export interface ChatHeaderProps {
  session: SessionMeta;
  wireState: LiveWireState;
  onOpenSettings?: () => void;
  /** Open the mobile sessions sheet. When provided, a top-left menu button is rendered as the FIRST
   * item in the header row (mobile-only; hidden on the desktop breakpoint where the rail is always
   * visible). This replaces the old floating FAB so nothing overlaps the conversation/composer. */
  onShowSessions?: () => void;
  /** Count of sessions awaiting a permission/question. When > 0 the menu button carries a loud iris
   * "needs you" pip + the count is folded into the button's aria-label. */
  needsYou?: number;
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

const midDot: CSSProperties = { fontFamily: "var(--font-mono)", color: "var(--text-faint)", flex: "none" };

export function ChatHeader({ session, wireState, onOpenSettings, onShowSessions, needsYou = 0 }: ChatHeaderProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        // Compact, flat top bar (spec .bar): a single hairline border-bottom, no glass, no float.
        // Sits flush against the chat — small + precise, neutral status.
        padding: "calc(11px + env(safe-area-inset-top, 0px)) 16px 11px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
      }}
    >
      {/* Top-left, IN-FLOW mobile menu button — the first item in the header row, before the cwd, so
          it never overlaps the session name (the name sits to its right). Mobile-only (hidden at the
          desktop breakpoint where the rail is always visible). Replaces the old floating FAB. */}
      {onShowSessions && <MobileMenuButton onShowSessions={onShowSessions} needsYou={needsYou} />}
      {/* The brand mark — a small flat elevated tile + a --line-2 edge; the ONE coral here is the
          GLYPH itself (spec .mark), NOT a coral fill. Compact, neutral, no glow. */}
      <span
        aria-hidden
        style={{
          width: 26,
          height: 26,
          flex: "none",
          borderRadius: 7,
          display: "grid",
          placeItems: "center",
          background: "var(--tile-bg)",
          border: "1px solid var(--tile-edge)",
          color: "var(--coral)",
        }}
      >
        <Icon name="terminal" size={15} />
      </span>
      {/* `flex: 1` so the identity column takes the slack between the menu button and the right-side
          status group (keeping that group pinned right); `min-width: 0` lets the path ellipsis clip.
          Mockup .hdr-id: the bold name (.cwd) over ONE quiet mono .meta line. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: 0, flex: 1 }}>
        {/* cwd basename in the display font — the session's name, the clearest line in the header. */}
        <strong
          className="display"
          style={{
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: "0.2px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {basename(session.cwd)}
        </strong>
        {/* ONE compact mono meta line (mockup .hdr-id .meta): the full cwd, then the active
            model/effort, then — most importantly — that --dangerously-skip-permissions is in effect
            (flagged in accent). Truncated as one ellipsised row so a long path can't overprint the
            right-side status group at 390px. */}
        <div
          style={{
            display: "flex",
            gap: "6px",
            alignItems: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: "var(--fs-xs)",
          }}
        >
          <Mono muted>{session.cwd}</Mono>
          {session.model && (
            <>
              <span aria-hidden style={midDot}>·</span>
              <Mono muted>{session.model}</Mono>
            </>
          )}
          {session.effort && (
            <>
              <span aria-hidden style={midDot}>·</span>
              <Mono muted>{session.effort}</Mono>
            </>
          )}
          {session.permissionMode === "bypassPermissions" ? (
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--warn)", flex: "none" }}>
              · skip-permissions
            </span>
          ) : (
            session.permissionMode && (
              <>
                <span aria-hidden style={midDot}>·</span>
                <Mono muted>{session.permissionMode}</Mono>
              </>
            )
          )}
        </div>
      </div>
      {/* `flex: none` so the status/settings group keeps its intrinsic width and is never
          squeezed or overlapped by the path column. */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: "none" }}>
        <LiveWire state={wireState} aria-label={`Session ${basename(session.cwd)} — ${wireState}`} />
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Session settings"
            className="rc-hdr-iconbtn"
            style={{
              // A compact 34px neutral icon tile (spec .ib) that brightens to text on hover — NEUTRAL,
              // no coral. Sits flush in the right status group.
              width: 34,
              height: 34,
              flex: "none",
              display: "grid",
              placeItems: "center",
              borderRadius: 9,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <Icon name="settings" size={17} />
            <style>{`.rc-hdr-iconbtn:hover { color: var(--text); border-color: var(--border-strong); }`}</style>
          </button>
        )}
      </div>
    </header>
  );
}
