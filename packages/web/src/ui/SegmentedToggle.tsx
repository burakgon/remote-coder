import type { ReactNode } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Optional leading icon (decorative). */
  icon?: ReactNode;
}

export interface SegmentedToggleProps<T extends string> {
  /** Accessible group name (rendered as the tablist's `aria-label`). */
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A small, keyboard-operable segmented control (Variant A). Built with tablist semantics: the group
 * is a `tablist`, each segment a `tab` with `aria-selected`/`aria-pressed`, and ArrowLeft/ArrowRight
 * (and Home/End) move the selection. Design-token only; the active segment gets the surface lift, the
 * rest stay quiet. Tap targets are ≥ var(--tap-min) tall.
 */
export function SegmentedToggle<T extends string>({ label, options, value, onChange }: SegmentedToggleProps<T>) {
  const index = options.findIndex((o) => o.value === value);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    let nextIndex = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIndex = (index + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIndex = (index - 1 + options.length) % options.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = options.length - 1;
    else return;
    e.preventDefault();
    const next = options[nextIndex];
    if (next) onChange(next.value);
  }

  return (
    <div role="tablist" aria-label={label} className="rc-seg" onKeyDown={onKeyDown}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-pressed={selected}
            tabIndex={selected ? 0 : -1}
            className={`rc-seg__btn${selected ? " rc-seg__btn--on" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.icon && (
              <span className="rc-seg__icon" aria-hidden="true">
                {o.icon}
              </span>
            )}
            <span>{o.label}</span>
          </button>
        );
      })}
      <style>{segCss}</style>
    </div>
  );
}

const segCss = `
.rc-seg {
  display: flex; gap: var(--sp-1);
  padding: var(--sp-1);
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius); width: 100%;
}
.rc-seg__btn {
  flex: 1; min-height: calc(var(--tap-min) - 8px);
  display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-2);
  background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm);
  color: var(--text-muted); cursor: pointer;
  font: inherit; font-weight: 600; font-size: var(--fs-sm);
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.rc-seg__btn:hover { color: var(--text); }
/* Nebula active segment — a faint violet wash + violet edge + label, so the selected mode (New /
   Resume) reads clearly on-brand without becoming a loud filled button. */
.rc-seg__btn--on {
  background: var(--accent-soft); color: var(--accent);
  border-color: var(--accent-line);
  box-shadow: var(--glow-accent);
}
.rc-seg__btn--on:hover { color: var(--accent); }
.rc-seg__icon { display: grid; place-items: center; color: currentColor; }
`;
