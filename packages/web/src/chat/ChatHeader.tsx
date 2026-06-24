import { Mono } from "../ui/Mono";
import { Icon } from "../ui/Icon";
import { LiveWire } from "../ui/LiveWire";
import type { LiveWireState } from "../ui/LiveWire";
import type { SessionMeta } from "../types/server";

export interface ChatHeaderProps {
  session: SessionMeta;
  wireState: LiveWireState;
  onOpenSettings?: () => void;
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

export function ChatHeader({ session, wireState, onOpenSettings }: ChatHeaderProps) {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
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
      <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
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
