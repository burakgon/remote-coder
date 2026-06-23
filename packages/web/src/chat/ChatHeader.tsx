import { Mono } from "../ui/Mono";
import { Button } from "../ui/Button";
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
        padding: "var(--sp-4)",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", minWidth: 0 }}>
        <strong className="display">{basename(session.cwd)}</strong>
        <Mono muted>{session.cwd}</Mono>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <LiveWire state={wireState} aria-label={`Session ${basename(session.cwd)} — ${wireState}`} />
        {onOpenSettings && (
          <Button variant="ghost" onClick={onOpenSettings} aria-label="Session settings">
            Settings
          </Button>
        )}
      </div>
    </header>
  );
}
