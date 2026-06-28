import type { CSSProperties } from "react";
import { lineDiff } from "./diff";

const panelStyle: CSSProperties = {
  background: "var(--code-bg)",
  border: "1px solid var(--code-border)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--sp-2) var(--sp-3)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-xs)",
  lineHeight: 1.55,
  color: "var(--code-text)",
  overflowX: "auto",
  margin: 0,
};

/**
 * Render an old→new change as a unified ±diff (LCS): removed lines in the error tint with a `-`, added
 * lines in the ok tint with a `+`, unchanged lines as quiet context. This is the terminal's edit
 * presentation, shared by the tool-step view AND the permission prompt (so you see WHAT you're approving).
 */
export function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = lineDiff(oldText, newText);
  return (
    <pre style={panelStyle}>
      {lines.map((l, i) => {
        const sign = l.type === "add" ? "+" : l.type === "remove" ? "-" : " ";
        const color = l.type === "add" ? "var(--ok)" : l.type === "remove" ? "var(--err)" : "var(--code-text)";
        const background =
          l.type === "add"
            ? "var(--ok-soft, rgba(126,176,108,0.10))"
            : l.type === "remove"
              ? "var(--err-soft, rgba(220,90,90,0.10))"
              : "transparent";
        return (
          <div key={i} style={{ color, background, display: "flex", gap: "var(--sp-2)" }}>
            <span aria-hidden style={{ flex: "none", opacity: 0.7, userSelect: "none" }}>
              {sign}
            </span>
            <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{l.text}</span>
          </div>
        );
      })}
    </pre>
  );
}
