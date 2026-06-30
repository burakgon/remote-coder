import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { createTerminalSocket, type TerminalSocket } from "../ws/terminal-socket";
import { terminalWsUrl } from "../api/client";
import { TerminalKeyBar } from "./TerminalKeyBar";
import { keySequence, ctrlSeq } from "./terminal-keys";

/** A full dark theme so xterm never falls back to default ANSI colors / a black viewport seam. */
const THEME = {
  background: "#0b0e14",
  foreground: "#cdd6e4",
  cursor: "#cdd6e4",
  cursorAccent: "#0b0e14",
  selectionBackground: "#2a3340",
  black: "#11151c",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#cdd6e4",
  brightBlack: "#5c6370",
  brightRed: "#e06c75",
  brightGreen: "#98c379",
  brightYellow: "#e5c07b",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
  brightWhite: "#ffffff",
} as const;

/** Renders a terminal session's claude TUI: xterm.js bridged to the binary terminal WebSocket. */
export function TerminalView({ sessionId }: { sessionId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | undefined>(undefined);
  const sockRef = useRef<TerminalSocket | undefined>(undefined);
  // Sticky Ctrl: a ref drives the keydown handler (set once), state drives the button highlight.
  const ctrlArmedRef = useRef(false);
  const [ctrlArmed, setCtrlArmedState] = useState(false);
  const setCtrlArmed = (v: boolean) => {
    ctrlArmedRef.current = v;
    setCtrlArmedState(v);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      // Use the SAME webfont the rest of the app loads (JetBrains Mono) so cell metrics are consistent and
      // `document.fonts.ready` actually gates on the font we render with.
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: { ...THEME },
      allowProposedApi: true,
      scrollback: 0, // tmux owns scrollback/altscreen; an outer xterm buffer just double-buffers confusingly
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    let disposed = false;
    let connected = false;

    // GPU renderer — the DOM renderer drifts sub-pixel and misaligns box-drawing (claude's TUI borders).
    // Best-effort: WebGL where available (mobile Safari/Chrome have it), silently fall back to DOM otherwise.
    void (async () => {
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        if (!disposed) term.loadAddon(webgl);
      } catch {
        /* DOM renderer is an acceptable fallback */
      }
    })();

    // Sticky Ctrl applied to the REAL/soft keyboard: when armed, the next single printable keypress becomes
    // its control byte (Ctrl-R, Ctrl-L, …) and xterm's own handling of it is suppressed. This is what makes
    // the bar's "Ctrl" actually work for typed keys, not just the bar's buttons.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (ctrlArmedRef.current && e.key.length === 1) {
        sockRef.current?.sendInput(ctrlSeq(e.key));
        setCtrlArmed(false);
        return false;
      }
      return true;
    });

    const refit = () => {
      if (disposed || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      sockRef.current?.sendResize(term.cols, term.rows);
    };
    // FIT FIRST, THEN connect with the fitted size in the URL, so the pty/tmux is BORN at the real viewport
    // (no spawn-at-80×24-then-reflow jump). Only connect once the host has a real size.
    const fitThenConnect = () => {
      if (connected || disposed || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      connected = true;
      const sock = createTerminalSocket({
        url: terminalWsUrl(sessionId, term.cols, term.rows),
        onData: (bytes) => term.write(bytes),
        onStatus: (s) => {
          if (s === "open") refit();
        },
      });
      sockRef.current = sock;
    };
    const tick = () => (connected ? refit() : fitThenConnect());

    const offData = term.onData((d) => sockRef.current?.sendInput(d));

    // two rAFs (layout settled) → fit+connect; fonts.ready re-fits once the webfont swaps in; RO handles
    // rotation / on-screen keyboard / split-view resizes (and connects if the host wasn't sized yet).
    const raf = requestAnimationFrame(() => requestAnimationFrame(tick));
    document.fonts?.ready?.then(tick).catch(() => undefined);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => tick()) : undefined;
    ro?.observe(host);
    term.focus();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      offData.dispose();
      sockRef.current?.close();
      term.dispose();
      sockRef.current = undefined;
      termRef.current = undefined;
    };
  }, [sessionId]);

  // Bar keys: emit the cursor-mode-correct bytes for the CURRENT terminal mode (arrows/Home/End), then keep
  // focus on the terminal so the on-screen keyboard stays up.
  const onBarKey = (label: string) => {
    const term = termRef.current;
    const appMode = !!term?.modes?.applicationCursorKeysMode;
    sockRef.current?.sendInput(keySequence(label, appMode));
    term?.focus();
  };
  const onCtrlChord = (letter: string) => {
    sockRef.current?.sendInput(ctrlSeq(letter));
    setCtrlArmed(false);
    termRef.current?.focus();
  };

  return (
    <div className="rc-terminal">
      <div className="rc-terminal__host" ref={hostRef} />
      <TerminalKeyBar
        ctrlArmed={ctrlArmed}
        onToggleCtrl={() => setCtrlArmed(!ctrlArmedRef.current)}
        onKey={onBarKey}
        onCtrlChord={onCtrlChord}
      />
      <style>{terminalCss}</style>
    </div>
  );
}

const terminalCss = `
.rc-terminal {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: #0b0e14;
}
.rc-terminal__host {
  flex: 1 1 auto; min-height: 0;
  overflow: hidden;
}
/* The padding lives on .xterm (NOT the host): FitAddon reads padding from the terminal element, so padding
   on the host was never subtracted from the grid math → the right column / bottom row got clipped ("shifted"). */
.rc-terminal__host .xterm { height: 100%; box-sizing: border-box; padding: 6px; }
/* xterm.css hardcodes the viewport background to #000; match the theme so there's no black seam on resize. */
.rc-terminal__host .xterm-viewport { background-color: #0b0e14 !important; }

/* Termux-style extra-keys row: a horizontally scrollable, touch-friendly key strip pinned below the
   terminal, with a safe-area inset so it clears the iOS home indicator / sits above the on-screen keyboard. */
.rc-termkeys {
  flex: 0 0 auto;
  display: flex; gap: 6px; align-items: center;
  padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
  background: #11151c; border-top: 1px solid #1e2530;
  overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.rc-termkeys::-webkit-scrollbar { display: none; }
.rc-termkeys button {
  flex: 0 0 auto; min-width: 38px; height: 36px; padding: 0 11px; margin: 0;
  border: 1px solid #2a3340; border-radius: 8px;
  background: #1b2230; color: #cdd6e4;
  font: 600 13px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: nowrap; cursor: pointer; user-select: none;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent;
}
.rc-termkeys button:active { background: #2a3340; }
.rc-termkeys .rc-termkeys__ctrl.is-on { background: #3b82f6; color: #fff; border-color: #3b82f6; }
`;
