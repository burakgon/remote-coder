export type LiveWireState =
  | "idle"
  | "dormant"
  | "thinking"
  | "streaming"
  | "awaiting"
  | "running-tool"
  | "success"
  | "error";

const LABELS: Record<LiveWireState, string> = {
  idle: "Idle",
  dormant: "Dormant",
  thinking: "Thinking",
  streaming: "Streaming",
  awaiting: "Awaiting you",
  "running-tool": "Running tool",
  success: "Done",
  error: "Error",
};

const COLORS: Record<LiveWireState, string> = {
  idle: "var(--text-muted)",
  // Dormant = resumable, process not live. A CALM, idle-ish look (faint, not the error tint): the
  // session is fine, just sleeping. Never reads as an error.
  dormant: "var(--text-faint)",
  thinking: "var(--accent)",
  streaming: "var(--accent)",
  awaiting: "var(--iris)",
  "running-tool": "var(--cyan)",
  success: "var(--ok)",
  error: "var(--err)",
};

export interface LiveWireProps {
  state: LiveWireState;
  "aria-label"?: string;
}

/**
 * The session's signature "live wire": a slim signal whose color + motion encode the
 * remote link's state. The pulse animation (defined in global/inline CSS) is disabled
 * under prefers-reduced-motion via the global stylesheet. Color is paired with a text
 * label so it is never the sole signal (a11y).
 */
export function LiveWire({ state, ...rest }: LiveWireProps) {
  // The "live"/active states pulse: thinking/streaming (violet accent), the awaiting violet, and the
  // working/running-tool CYAN dot. All pulses are neutralized under prefers-reduced-motion (global.css).
  const animated =
    state === "thinking" || state === "streaming" || state === "awaiting" || state === "running-tool";
  // The "working" (running-tool) dot is the Nebula LIVE signal: a pulsing CYAN core wrapped in a soft
  // expanding cyan "ping" halo (rc-ping, defined in global.css) — the one chrome dot that earns motion.
  const working = state === "running-tool";
  const color = COLORS[state];
  return (
    <span
      role="status"
      aria-label={rest["aria-label"] ?? LABELS[state]}
      data-state={state}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-xs)",
        color,
      }}
    >
      <span
        className={working ? "rc-wire-dot rc-wire-dot--live" : "rc-wire-dot"}
        aria-hidden
        style={{
          position: "relative",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${animated ? color : "transparent"}`,
          animation: animated ? "rc-pulse 1.2s ease-in-out infinite" : "none",
        }}
      />
      <span style={{ color: "var(--text-muted)" }}>{LABELS[state]}</span>
      <style>{`
        @keyframes rc-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        /* The cyan "working" ping ring — a soft expanding cyan halo around the live dot. */
        .rc-wire-dot--live::after {
          content: ""; position: absolute; inset: -3px;
          border-radius: 50%; border: 1.5px solid var(--cyan); opacity: 0.5;
          animation: rc-ping 1.9s ease-out infinite;
        }
      `}</style>
    </span>
  );
}
