import { useEffect, useRef } from "react";
import { Surface } from "../ui/Surface";
import { Button } from "../ui/Button";
import { Mono } from "../ui/Mono";
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
}

/** Pull a short human-readable detail from the tool input for display (path/command/question). */
function summarizeInput(input: unknown): string | undefined {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    for (const key of ["file_path", "command", "path", "url", "question"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
  }
  return undefined;
}

export function PermissionPrompt({ permission, onAnswer, onAlwaysAllow }: PermissionPromptProps) {
  const detail = summarizeInput(permission.toolInput);
  const toolName = permission.toolName ?? "tool";

  // a11y: when the prompt appears, move focus to it so a keyboard / screen-reader user lands on the
  // request immediately (Claude is waiting on the remote machine). The region is the focus target;
  // the iris color is paired with the "Awaiting you" TEXT so color is never the sole signal.
  const regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    regionRef.current?.focus();
  }, [permission.requestId]);

  return (
    <Surface level={2} as="article">
      <div
        ref={regionRef}
        role="region"
        aria-label="Permission request"
        tabIndex={-1}
        style={{
          borderLeft: "3px solid var(--iris)",
          padding: "var(--sp-4)",
          display: "grid",
          gap: "var(--sp-3)",
        }}
      >
        <div style={{ color: "var(--iris)", fontFamily: "var(--font-display)" }}>Awaiting you — permission</div>
        <div>
          Allow <Mono>{toolName}</Mono>
          {detail && (
            <>
              {" — "}
              <Mono muted>{detail}</Mono>
            </>
          )}
          ?
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
          <Button variant="primary" onClick={() => onAnswer("allow")} aria-label="Allow">
            Allow
          </Button>
          <Button variant="ghost" onClick={() => onAnswer("deny")} aria-label="Deny">
            Deny
          </Button>
          {onAlwaysAllow && permission.toolName && (
            <Button
              variant="ghost"
              onClick={() => {
                onAnswer("allow");
                onAlwaysAllow(permission.toolName!);
              }}
              aria-label={`Always allow ${permission.toolName}`}
            >
              Always allow {permission.toolName}
            </Button>
          )}
        </div>
      </div>
    </Surface>
  );
}
