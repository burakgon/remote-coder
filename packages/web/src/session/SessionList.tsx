import { Icon } from "../ui/Icon";
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

/**
 * The session rail / sheet: a calm, scannable, hairline-separated list (Variant A). Each session is
 * one clean row — the cwd basename in the display font, the muted path beneath it, the LiveWire dot
 * + the model·effort meta — with a clear amber-edged selected state. The "New session" affordance is
 * a quiet icon `+` button (labeled for a11y), not a heavy text button. Works as the desktop rail
 * (var(--rail-w)) and as the mobile sheet. Logic/props are unchanged from the prior version.
 */
export function SessionList({ sessions, activeId, onSelect, onNew, viewWireState }: SessionListProps) {
  return (
    <div className="rc-sl">
      <div className="rc-sl__head">
        <span className="display rc-sl__title">Sessions</span>
        <button type="button" className="rc-sl__new" onClick={onNew} aria-label="New session">
          <Icon name="bolt" size={16} />
          <span className="rc-sl__new-plus" aria-hidden="true">
            +
          </span>
        </button>
      </div>
      <ul className="rc-sl__list">
        {sessions.map((s) => {
          const selected = s.id === activeId;
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`rc-sl__row${selected ? " rc-sl__row--active" : ""}`}
                onClick={() => onSelect(s.id)}
                aria-current={selected ? "true" : undefined}
              >
                <span className="rc-sl__rail" aria-hidden="true" />
                <span className="rc-sl__main">
                  <span className="rc-sl__top">
                    <strong className="display rc-sl__name">{basename(s.cwd)}</strong>
                    <LiveWire state={viewWireState(s.id)} />
                  </span>
                  {/* Keep the full path as one text node (muted, ellipsised) so it stays scannable
                      and selectable; the basename is what the eye lands on above it. */}
                  <span className="rc-sl__path" title={s.cwd}>
                    {s.cwd}
                  </span>
                  {(s.model || s.effort) && (
                    <span className="rc-sl__meta">
                      {s.model && <span>{s.model}</span>}
                      {s.model && s.effort && <span aria-hidden="true">·</span>}
                      {s.effort && <span>{s.effort}</span>}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {sessions.length === 0 && (
          <li className="rc-sl__empty">
            No sessions yet. Tap the{" "}
            <span className="rc-sl__empty-em" aria-hidden="true">
              +
            </span>{" "}
            above to start one.
          </li>
        )}
      </ul>

      <style>{sessionListCss}</style>
    </div>
  );
}

const sessionListCss = `
.rc-sl { display: flex; flex-direction: column; height: 100%; }
.rc-sl__head {
  flex: none;
  display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--border);
}
.rc-sl__title {
  font-size: var(--fs-lg); letter-spacing: 0.01em; color: var(--text);
}
.rc-sl__new {
  position: relative;
  width: var(--tap-min); height: var(--tap-min); flex: none;
  display: grid; place-items: center;
  border-radius: var(--radius);
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text-muted); cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}
.rc-sl__new:hover { color: var(--accent); border-color: var(--accent); }
/* A small "+" badge over the bolt so the affordance reads as "new" without a heavy text button. */
.rc-sl__new-plus {
  position: absolute; right: 6px; bottom: 5px;
  font-family: var(--font-display); font-weight: 600; font-size: 12px; line-height: 1;
  color: var(--accent);
}
.rc-sl__list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
.rc-sl__row {
  position: relative;
  width: 100%; text-align: left;
  min-height: var(--tap-min);
  display: flex; align-items: stretch; gap: 0;
  background: transparent; border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text); cursor: pointer;
  padding: 0;
  transition: background 120ms ease;
}
.rc-sl__row:hover { background: var(--surface); }
.rc-sl__row--active { background: var(--surface-2); }
/* The selected accent edge — a hairline amber rail down the left, calm not loud. */
.rc-sl__rail { flex: none; width: 2px; background: transparent; }
.rc-sl__row--active .rc-sl__rail { background: var(--accent); }
.rc-sl__main {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 3px;
  padding: var(--sp-3) var(--sp-4);
}
.rc-sl__top { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
.rc-sl__name {
  font-size: var(--fs-base); font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.rc-sl__path {
  font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rc-sl__meta {
  display: flex; align-items: center; gap: var(--sp-1);
  font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-faint);
}
.rc-sl__empty { padding: var(--sp-4); color: var(--text-muted); font-size: var(--fs-sm); line-height: 1.5; }
.rc-sl__empty-em { color: var(--accent); font-family: var(--font-display); font-weight: 600; }
`;
