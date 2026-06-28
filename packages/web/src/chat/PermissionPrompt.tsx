import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { IrisCard } from "./IrisCard";
import { DiffView } from "./DiffView";
import { Markdown } from "./Markdown";
import type { PermissionPayload } from "../types/server";

export interface PermissionPromptProps {
  permission: PermissionPayload;
  onAnswer: (decision: "allow" | "deny") => void;
  /**
   * Optional client-side "Always allow" rule. When provided, an extra ghost button appears that
   * answers `allow` for the current request AND registers an auto-allow rule for this tool, scoped
   * to the session (the caller decides where to remember it). Omit the handler to hide the button —
   * we never ship a dead control.
   */
  onAlwaysAllow?: (toolName: string) => void;
  /** The session's active permission mode (default | acceptEdits | plan | bypassPermissions) — shown as
   *  a small chip so the user knows the standing posture under which they're being asked. */
  permissionMode?: string;
}

/** Pull a short one-line detail from the tool input for the simple case (path/url/question). */
function summarizeInput(input: unknown): string | undefined {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    for (const key of ["file_path", "command", "path", "url", "question"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
  }
  return undefined;
}

const monoPanel: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-sm)",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--sp-2) var(--sp-3)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  maxHeight: 220,
  overflowY: "auto",
  margin: 0,
};

/**
 * Heuristic flag for a visibly destructive shell command so the mono panel is tinted with --err (the
 * mockup's `rm -rf` treatment). Presentation only — it never changes what the prompt does (the user
 * still decides), it just makes a dangerous command read as dangerous at a glance.
 */
function isDangerousCommand(detail: string | undefined): boolean {
  if (!detail) return false;
  return /\brm\s+-[a-z]*[rf]|\bsudo\b|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|>\s*\/dev\/sd|\bchmod\s+-R\s+777|\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)|\bcurl\b.*\|\s*(sh|bash)|\bnpm\s+publish|--force\b|-rf\b/i.test(
    detail,
  );
}

/** What's being approved, rendered RICHLY so the user knows exactly what they're allowing: a Bash command
 *  (newlines preserved, danger-tinted), an Edit/MultiEdit as a ±diff, a Write's content preview, else the
 *  one-line path/url/question. The terminal shows the diff/command; a bare "Allow Edit" hid the change. */
function PermissionDetail({ toolName, input }: { toolName: string; input: unknown }) {
  const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  if (toolName === "Bash" && typeof obj.command === "string") {
    const dangerous = isDangerousCommand(obj.command);
    return (
      <pre
        style={{
          ...monoPanel,
          color: dangerous ? "var(--err)" : "var(--text)",
          background: dangerous ? "var(--err-bg)" : "var(--surface-2)",
          border: `1px solid ${dangerous ? "var(--err-border)" : "var(--border)"}`,
        }}
      >
        {obj.command}
      </pre>
    );
  }

  // Edit: show the file + the ±diff of what changes.
  if (typeof obj.old_string === "string" && typeof obj.new_string === "string") {
    return (
      <>
        {typeof obj.file_path === "string" && <PathLine path={obj.file_path} />}
        <DiffView oldText={obj.old_string} newText={obj.new_string} />
      </>
    );
  }
  // MultiEdit: file + one diff per edit.
  if (toolName === "MultiEdit" && Array.isArray(obj.edits)) {
    return (
      <>
        {typeof obj.file_path === "string" && <PathLine path={obj.file_path} />}
        {obj.edits.map((e, i) => {
          const ed = (e ?? {}) as { old_string?: unknown; new_string?: unknown };
          if (typeof ed.old_string !== "string" || typeof ed.new_string !== "string") return null;
          return <DiffView key={i} oldText={ed.old_string} newText={ed.new_string} />;
        })}
      </>
    );
  }
  // ExitPlanMode: show the PROPOSED PLAN (markdown) being approved, not "Allow ExitPlanMode".
  if (toolName === "ExitPlanMode" && typeof obj.plan === "string") {
    return (
      <div
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "var(--sp-2) var(--sp-3)",
          maxHeight: 280,
          overflowY: "auto",
          color: "var(--text)",
        }}
      >
        <Markdown>{obj.plan}</Markdown>
      </div>
    );
  }
  // Write: file + a preview of the content being written.
  if (typeof obj.content === "string" && (typeof obj.file_path === "string" || typeof obj.path === "string")) {
    const path = typeof obj.file_path === "string" ? obj.file_path : (obj.path as string);
    return (
      <>
        <PathLine path={path} />
        <pre style={monoPanel}>{obj.content}</pre>
      </>
    );
  }

  const detail = summarizeInput(input);
  if (!detail) return null;
  return <pre style={{ ...monoPanel, wordBreak: "break-all" }}>{detail}</pre>;
}

function PathLine({ path }: { path: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-xs)",
        color: "var(--text-muted)",
        marginBottom: 4,
        overflowWrap: "anywhere",
      }}
    >
      {path}
    </div>
  );
}

export function PermissionPrompt({ permission, onAnswer, onAlwaysAllow, permissionMode }: PermissionPromptProps) {
  const toolName = permission.toolName ?? "tool";
  // The mode chip is shown only for a NON-default standing posture (default is implicit; bypass never asks).
  const showMode =
    permissionMode !== undefined && permissionMode !== "default" && permissionMode !== "bypassPermissions";

  // a11y: when the prompt appears, move focus to it so a keyboard / screen-reader user lands on the
  // request immediately (Claude is waiting on the remote machine). The IrisCard region is the focus
  // target; the iris color is paired with the "Awaiting you" TEXT so color is never the sole signal.
  const regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    regionRef.current?.focus();
  }, [permission.requestId]);

  return (
    <IrisCard title="Awaiting you — permission" ariaLabel="Permission request" regionRef={regionRef}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--fs-base)" }}>
          Claude wants to run{" "}
          <strong style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}>{toolName}</strong>
        </span>
        {showMode && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-xs)",
              color: "var(--text-muted)",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-pill)",
              padding: "1px var(--sp-2)",
            }}
          >
            mode: {permissionMode}
          </span>
        )}
      </div>
      <PermissionDetail toolName={toolName} input={permission.toolInput} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
        <button
          type="button"
          onClick={() => onAnswer("allow")}
          aria-label="Allow"
          style={{
            // The ONE coral primary in the awaiting card — a FLAT coral fill, dark ink label (spec
            // .btn.allow). The card's accent affordance; no glow.
            flex: 1,
            minHeight: "var(--tap-min)",
            padding: "0 var(--sp-4)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid transparent",
            background: "var(--accent-grad)",
            color: "var(--on-iris)",
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: "var(--fs-sm)",
            cursor: "pointer",
          }}
        >
          Allow
        </button>
        <button
          type="button"
          onClick={() => onAnswer("deny")}
          aria-label="Deny"
          style={{
            // Deny is a NEUTRAL outline (spec .btn.deny) — transparent + muted label + a --line-2
            // hairline. It must not read as the destructive-red action; the danger flag lives on the
            // command panel above, not the Deny button.
            flex: 1,
            minHeight: "var(--tap-min)",
            padding: "0 var(--sp-4)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-strong)",
            background: "transparent",
            color: "var(--text-muted)",
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: "var(--fs-sm)",
            cursor: "pointer",
          }}
        >
          Deny
        </button>
        {onAlwaysAllow && permission.toolName && (
          <button
            type="button"
            onClick={() => {
              onAnswer("allow");
              onAlwaysAllow(permission.toolName!);
            }}
            aria-label={`Always allow ${permission.toolName}`}
            style={{
              // Always-allow is also a NEUTRAL outline (secondary) — quiet, no coral.
              flex: 1.35,
              minHeight: "var(--tap-min)",
              padding: "0 var(--sp-3)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-strong)",
              background: "transparent",
              color: "var(--text-muted)",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: "var(--fs-xs)",
              cursor: "pointer",
            }}
          >
            Always allow {permission.toolName}
          </button>
        )}
      </div>
    </IrisCard>
  );
}
