import { Button } from "../ui/Button";
import { Mono } from "../ui/Mono";
import { LiveWire } from "../ui/LiveWire";
import type { LiveWireState } from "../ui/LiveWire";
import type { SessionMeta } from "../types/server";

export interface SessionListProps {
  sessions: SessionMeta[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  viewWireState: (id: string) => LiveWireState;
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

export function SessionList({ sessions, activeId, onSelect, onNew, viewWireState }: SessionListProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "var(--sp-3)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span className="display" style={{ fontSize: "var(--fs-lg)" }}>
          Sessions
        </span>
        <Button variant="primary" onClick={onNew} aria-label="New session">
          + New session
        </Button>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, overflowY: "auto", flex: 1 }}>
        {sessions.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              aria-current={s.id === activeId ? "true" : undefined}
              style={{
                width: "100%",
                textAlign: "left",
                minHeight: "var(--tap-min)",
                background: s.id === activeId ? "var(--surface-2)" : "transparent",
                border: "none",
                borderBottom: "1px solid var(--border)",
                color: "var(--text)",
                padding: "var(--sp-3)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-1)",
              }}
            >
              <span
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--sp-2)" }}
              >
                <strong>{basename(s.cwd)}</strong>
                <LiveWire state={viewWireState(s.id)} />
              </span>
              <Mono muted>{s.cwd}</Mono>
            </button>
          </li>
        ))}
        {sessions.length === 0 && (
          <li style={{ padding: "var(--sp-4)", color: "var(--text-muted)" }}>
            No sessions yet. Start one with “New session”.
          </li>
        )}
      </ul>
    </div>
  );
}
