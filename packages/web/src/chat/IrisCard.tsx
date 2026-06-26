import type { CSSProperties, ReactNode, Ref } from "react";

export interface IrisCardProps {
  /** The "Awaiting you — …" title shown next to the pulsing iris dot. */
  title: string;
  /** Accessible name for the announced region (e.g. "Permission request"). */
  ariaLabel: string;
  /** Ref to the focusable region (the prompts move focus here when they appear). */
  regionRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/**
 * The iris "awaiting you" card — the ONE place the UI deliberately grabs attention. An iris-accented
 * card (iris border + a soft halo + a faint iris wash), a pulsing iris dot paired with the
 * "Awaiting you — …" TEXT (color is never the sole signal, a11y), and a quick entrance rise. The
 * region is the focus target and is announced via role="region" + aria-label + aria-live="assertive"
 * so a keyboard / screen-reader user lands on the request immediately (Claude is waiting remotely).
 *
 * All motion (the entrance rise, the halo pulse) references keyframes defined once in global.css and
 * is neutralized under prefers-reduced-motion by that stylesheet's reduce block.
 */
export function IrisCard({ title, ariaLabel, regionRef, children }: IrisCardProps) {
  return (
    <div
      ref={regionRef}
      role="region"
      aria-label={ariaLabel}
      tabIndex={-1}
      style={{
        borderRadius: "var(--radius)",
        border: "1px solid var(--iris-card-border)",
        background: "var(--iris-card-bg-top)",
        boxShadow: "var(--iris-halo)",
        overflow: "hidden",
        animation: "rc-rise 0.35s ease-out",
      }}
    >
      {/* The ONE coral lead — a 2px coral top-bar (spec .await .bar2). */}
      <div aria-hidden style={{ height: 2, background: "var(--coral)" }} />
      <div style={{ padding: "13px 14px", display: "grid", gap: "11px" }}>
        {/* Uppercase coral label (spec .await .t) — the attention signal, paired with the pulsing dot
            so it's never color-only (a11y). The POLITE live region is scoped to this STATIC title (not
            the interactive form), so the prompt is announced when it appears WITHOUT re-announcing on
            every option toggle / "Other" reveal (the old card-wide assertive live region did that). */}
        <div
          aria-live="polite"
          aria-atomic="true"
          style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
        >
          <span aria-hidden style={IRIS_DOT} />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              color: "var(--coral-2)",
              fontSize: "11px",
              letterSpacing: "0.3px",
              textTransform: "uppercase",
            }}
          >
            {title}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

const IRIS_DOT: CSSProperties = {
  width: 7,
  height: 7,
  flex: "none",
  borderRadius: "50%",
  background: "var(--coral)",
  animation: "rc-halo 1.6s infinite",
};
