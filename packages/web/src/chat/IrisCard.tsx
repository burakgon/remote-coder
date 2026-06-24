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
      aria-live="assertive"
      tabIndex={-1}
      style={{
        borderRadius: "var(--radius)",
        border: "1px solid var(--iris-card-border)",
        background: "linear-gradient(180deg, var(--iris-card-bg-top), var(--iris-card-bg-bottom))",
        boxShadow: "var(--iris-halo)",
        overflow: "hidden",
        animation: "rc-rise 0.35s ease-out",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "var(--sp-3) var(--sp-4)",
          borderBottom: "1px solid var(--iris-card-divider)",
        }}
      >
        <span aria-hidden style={IRIS_DOT} />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            color: "var(--iris)",
            fontSize: "var(--fs-sm)",
            letterSpacing: "0.02em",
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ padding: "var(--sp-4)", display: "grid", gap: "var(--sp-3)" }}>{children}</div>
    </div>
  );
}

const IRIS_DOT: CSSProperties = {
  width: 9,
  height: 9,
  flex: "none",
  borderRadius: "50%",
  background: "var(--iris)",
  animation: "rc-halo 1.6s infinite",
};
