import { useState } from "react";
import { Icon } from "../ui/Icon";
import { Mono } from "../ui/Mono";

export interface AutoAllowChipProps {
  /** The active per-session auto-allow tool names. When empty, the chip renders nothing. */
  tools: string[];
  /** Clear a single rule (live-decrements N). */
  onClear: (tool: string) => void;
}

/**
 * Compact, quiet replacement for the old sticky "Auto-allow (this session)" list. A small chip near
 * the composer — a `bolt` icon + "N auto-allowed" — that taps open into a popover of the active rules,
 * each with a tiny `x` to clear it (live-decrement). Presentation only; the auto-allow LOGIC (the set,
 * the isAutoAllowed effect) is unchanged and lives in ChatView. Renders nothing when there are 0 rules.
 */
export function AutoAllowChip({ tools, onClear }: AutoAllowChipProps) {
  const [open, setOpen] = useState(false);
  if (tools.length === 0) return null;

  return (
    <div style={{ position: "relative", padding: "var(--sp-2) var(--sp-3) 0" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${tools.length} auto-allowed ${tools.length === 1 ? "tool" : "tools"}${open ? ", collapse" : ", expand"}`}
        style={{
          // A quiet NEUTRAL chip (no coral) — an elevated surface + hairline, muted label.
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          minHeight: "var(--tap-min)",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          color: "var(--text-muted)",
          borderRadius: 999,
          padding: "5px 12px",
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: "var(--fs-sm)",
          cursor: "pointer",
        }}
      >
        <Icon name="bolt" size={15} style={{ color: "var(--text-muted)" }} />
        <span style={{ color: "var(--text)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {tools.length}
        </span>
        <span>auto-allowed</span>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={13} style={{ color: "var(--text-faint)" }} />
      </button>

      {open && (
        <div
          role="list"
          aria-label="Auto-allow rules"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--sp-2)",
            marginTop: "var(--sp-2)",
            animation: "rc-reveal 0.16s ease-out",
          }}
        >
          {/* rc-reveal keyframe lives in global.css (neutralized by the global prefers-reduced-motion block). */}
          {tools.map((tool) => (
            <span
              key={tool}
              role="listitem"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "4px 6px 4px 11px",
                color: "var(--text-muted)",
              }}
            >
              <Mono muted>{tool}</Mono>
              <button
                type="button"
                onClick={() => onClear(tool)}
                aria-label={`Clear auto-allow for ${tool}`}
                style={{
                  // 44px tap target (transparent) wrapping a compact 22px visible circle.
                  width: "var(--tap-min)",
                  height: "var(--tap-min)",
                  flex: "none",
                  display: "grid",
                  placeItems: "center",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text-faint)",
                  }}
                >
                  <Icon name="x" size={11} />
                </span>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
