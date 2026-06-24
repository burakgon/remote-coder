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

export function ChatHeader({ session, wireState, onOpenSettings, onShowSessions, needsYou = 0 }: ChatHeaderProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-3) var(--sp-4)",
        // Deep glassy bar — a translucent, blurred surface over the ambient glow, with a hairline
        // bottom border (Nebula chrome). The glass lets the violet→cyan ambient show through.
        borderBottom: "1px solid var(--border)",
        background: "var(--glass)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
      }}
    >
      {/* Top-left, IN-FLOW mobile menu button — the first item in the header row, before the cwd, so
          it never overlaps the session name (the name sits to its right). Mobile-only (hidden at the
          desktop breakpoint where the rail is always visible). Replaces the old floating FAB. */}
      {onShowSessions && <MobileMenuButton onShowSessions={onShowSessions} needsYou={needsYou} />}
      {/* `flex: 1` so the cwd column takes the slack between the menu button and the right-side
          status group (keeping that group pinned right); `min-width: 0` lets the path ellipsis clip. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
        {/* cwd basename in the display font — the session's name, the clearest line in the header. */}
        <strong
          className="display"
          style={{
            fontSize: "var(--fs-base)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {basename(session.cwd)}
        </strong>
        {/* Truncate the cwd so a long path can't overrun and overprint the right-side status
            group at narrow widths (390px). The parent column is already a `min-width:0` flex
            child, which is what lets the ellipsis actually clip instead of forcing overflow. The
            muted full path + the meta row share one mono baseline so the header reads as one quiet
            block under the bold name. */}
        <div
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "var(--fs-xs)",
          }}
        >
          <Mono muted>{session.cwd}</Mono>
        </div>
        {/* Surface the ACTIVE per-session settings so the user can confirm model/effort and — most
            importantly — that --dangerously-skip-permissions is in effect (no permission prompts).
            Each item is mono, separated by a faint middot, with skip-permissions flagged in accent. */}
        {(session.model || session.effort || session.permissionMode) && (
          <div
            style={{
              display: "flex",
              gap: "var(--sp-2)",
              alignItems: "center",
              flexWrap: "wrap",
              fontSize: "var(--fs-xs)",
            }}
          >
            {session.model && <Mono muted>{session.model}</Mono>}
            {session.effort && <Mono muted>{`· ${session.effort}`}</Mono>}
            {session.permissionMode === "bypassPermissions" ? (
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
                · skip-permissions
              </span>
            ) : (
              session.permissionMode && <Mono muted>{`· ${session.permissionMode}`}</Mono>
            )}
          </div>
        )}
      </div>
      {/* `flex: none` so the status/settings group keeps its intrinsic width and is never
          squeezed or overlapped by the path column. */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flex: "none" }}>
        <LiveWire state={wireState} aria-label={`Session ${basename(session.cwd)} — ${wireState}`} />
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Session settings"
            style={{
              width: "var(--tap-min)",
              height: "var(--tap-min)",
              flex: "none",
              display: "grid",
              placeItems: "center",
              borderRadius: "var(--radius)",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <Icon name="settings" size={18} />
          </button>
        )}
      </div>
    </header>
  );
}
