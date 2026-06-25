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
  // NEUTRAL grayscale for every non-attention state — coral never bleeds onto Working/Streaming/Idle
  // (spec). The ONE coral status is "awaiting you"; error keeps a restrained red.
  idle: "var(--text-muted)",
  // Dormant = resumable, process not live. A CALM, idle-ish look (faint): the session is fine, just
  // sleeping. Never reads as an error.
  dormant: "var(--text-faint)",
  thinking: "var(--text-muted)",
  streaming: "var(--text-muted)",
  awaiting: "var(--coral-2)",
  "running-tool": "var(--text-muted)",
  success: "var(--text-muted)",
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
  // The live states pulse the dot subtly (thinking/streaming/running-tool/awaiting). All pulses are
  // neutralized under prefers-reduced-motion (global.css).
  const animated =
    state === "thinking" || state === "streaming" || state === "awaiting" || state === "running-tool";
  // The ONE coral status is "awaiting you" — its dot is coral. Every other state is a NEUTRAL dot +
  // muted label (spec): no coral chip, no coral wash, no glow on Working/Streaming/Idle.
  const awaiting = state === "awaiting";
  const color = COLORS[state];
  return (
    <span
      role="status"
      aria-label={rest["aria-label"] ?? LABELS[state]}
      data-state={state}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-xs)",
        color: "var(--text-muted)",
      }}
    >
      <span
        className="rc-wire-dot"
        aria-hidden
        style={{
          position: "relative",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          // The coral awaiting dot earns a soft coral halo; neutral dots stay flat.
          boxShadow: awaiting ? "0 0 0 3px rgba(247,124,68,.12)" : "none",
          animation: animated ? "rc-pulse 1.2s ease-in-out infinite" : "none",
        }}
      />
      <span style={{ color: awaiting ? "var(--coral-2)" : "var(--text-muted)" }}>{LABELS[state]}</span>
      <style>{`@keyframes rc-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </span>
  );
}
