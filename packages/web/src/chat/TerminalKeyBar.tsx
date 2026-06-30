/** Termux-style mobile helper row: the TUI keys a phone keyboard lacks. Presentational only — TerminalView
 *  owns the state and decides what each key emits (mode-aware cursor keys, the sticky-Ctrl modifier that the
 *  next REAL keystroke picks up, etc.). Horizontally scrollable so the full set fits any width.
 *
 *  Every button uses onMouseDown=preventDefault so a tap NEVER moves focus off xterm's hidden textarea —
 *  otherwise tapping a key would dismiss the on-screen keyboard and break typing. */
export function TerminalKeyBar({
  ctrlArmed,
  onToggleCtrl,
  onKey,
  onCtrlChord,
}: {
  ctrlArmed: boolean;
  onToggleCtrl: () => void;
  onKey: (label: string) => void;
  onCtrlChord: (letter: string) => void;
}) {
  const keys = [
    "Esc", "Tab",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "Home", "End", "PageUp", "PageDown",
    "/", "-", "|", "~",
  ];
  const keep = (e: React.MouseEvent) => e.preventDefault(); // don't steal focus from the terminal
  return (
    <div className="rc-termkeys" role="toolbar" aria-label="Terminal keys">
      <button
        type="button"
        aria-pressed={ctrlArmed}
        className={ctrlArmed ? "rc-termkeys__ctrl is-on" : "rc-termkeys__ctrl"}
        onMouseDown={keep}
        onClick={onToggleCtrl}
      >
        Ctrl
      </button>
      {keys.map((k) => (
        <button type="button" key={k} aria-label={k} onMouseDown={keep} onClick={() => onKey(k)}>
          {labelFor(k)}
        </button>
      ))}
      <button type="button" aria-label="Ctrl-C" onMouseDown={keep} onClick={() => onCtrlChord("c")}>
        ^C
      </button>
      <button type="button" aria-label="Ctrl-D" onMouseDown={keep} onClick={() => onCtrlChord("d")}>
        ^D
      </button>
    </div>
  );
}

function labelFor(k: string): string {
  return (
    {
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Home: "Home",
      End: "End",
      PageUp: "PgUp",
      PageDown: "PgDn",
    }[k] ?? k
  );
}
