/**
 * Clean dark code block (spec .code). A flat #0e0e10 card with a hairline border + a quiet header
 * carrying an optional filename/language label and a "copy" affordance — NO traffic-light dots. The
 * code body is monochrome neutral mono.
 *
 * Shiki highlighting is intentionally deferred to keep render synchronous and test-friendly; a plain
 * <pre> in the mono face is the always-available baseline. (A later enhancement can swap in shiki's
 * async highlight using the neutral --code-keyword/--code-string/--code-comment/--code-function tokens
 * without changing this component's props.)
 *
 * SECURITY: `code` is rendered as a text child of <code>, never via dangerouslySetInnerHTML, so
 * untrusted model output cannot inject HTML. A future shiki pass must likewise receive `code` as
 * text and only set the (sanitized, shiki-produced) highlight HTML it generates itself.
 */
export interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  return (
    <div
      data-language={language}
      style={{
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
        margin: "2px 0 9px",
        // A clean dark card: a flat #0e0e10 panel with a hairline (no blur, no glass).
        background: "var(--code-bg)",
        border: "1px solid var(--code-border)",
      }}
    >
      {/* Quiet header — a filename/language label + a "copy" affordance (text), no traffic-light dots. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 11px",
          borderBottom: "1px solid var(--code-border)",
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          color: "var(--text-muted)",
        }}
      >
        <span>{language ?? "code"}</span>
        <span aria-hidden style={{ marginLeft: "auto", color: "var(--text-faint)" }}>
          copy
        </span>
      </div>
      <pre
        style={{
          padding: "11px 13px",
          overflowX: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          lineHeight: 1.65,
          color: "var(--code-text)",
          margin: 0,
        }}
      >
        <code style={{ fontFamily: "var(--font-mono)", color: "inherit" }}>{code}</code>
      </pre>
    </div>
  );
}
