/**
 * Clean dark code block (spec .code). A flat #0e0e10 card with a hairline border + a quiet header
 * carrying the language label and a working "copy" button — NO traffic-light dots.
 *
 * Syntax highlighting is done with **shiki** (the elegant, muted `vitesse-dark` theme), loaded lazily
 * via `import("shiki")` so it code-splits out of the main bundle and only loads when a code block is
 * shown. The highlight runs async in an effect; until it resolves — and for an unknown language, a
 * load error, or no language at all — a plain mono <pre> is the always-available baseline.
 *
 * SECURITY: `code` is given to shiki as TEXT (shiki escapes it and emits only its own coloured spans),
 * and to the fallback as a text child of <code>. Untrusted model output can never inject HTML — the
 * only thing set via dangerouslySetInnerHTML is shiki's own sanitized, self-produced output.
 */
import { useEffect, useState } from "react";
import type { ThemeRegistrationAny } from "shiki";

export interface CodeBlockProps {
  code: string;
  language?: string;
}

// Common fence labels → shiki language ids. Anything not resolvable falls back to plain mono.
const LANG_ALIAS: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  md: "markdown",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  "c++": "cpp",
  cs: "csharp",
  golang: "go",
};

function normalizeLang(language?: string): string | undefined {
  if (!language) return undefined;
  const l = language.toLowerCase();
  return LANG_ALIAS[l] ?? l;
}

// Our own syntax theme — coral-led keywords (the brand accent) + warm muted tones, cohesive with the
// clean-dark UI instead of a generic cool rainbow. A shiki theme object passed straight to codeToHtml.
const THEME: ThemeRegistrationAny = {
  name: "remote-coder",
  type: "dark",
  colors: { "editor.background": "#0e0e10", "editor.foreground": "#cdccd4" },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#615f6b", fontStyle: "italic" } },
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.control",
        "keyword.operator.expression",
        "variable.language",
        "constant.language.boolean",
        "keyword.operator.new",
      ],
      settings: { foreground: "#f0814f" },
    },
    { scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"], settings: { foreground: "#a6b88c" } },
    { scope: ["constant.numeric", "constant.language", "constant.character", "keyword.other.unit"], settings: { foreground: "#e0a96d" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call", "entity.name.method"], settings: { foreground: "#eac392" } },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class", "entity.name.namespace"],
      settings: { foreground: "#d8ac88" },
    },
    { scope: ["variable", "variable.other.readwrite", "meta.definition.variable"], settings: { foreground: "#cdccd4" } },
    { scope: ["variable.parameter", "variable.other.parameter"], settings: { foreground: "#bdb4c2", fontStyle: "italic" } },
    { scope: ["meta.object-literal.key", "support.type.property-name", "variable.other.property"], settings: { foreground: "#cabb9f" } },
    { scope: ["keyword.operator", "punctuation", "meta.brace", "meta.delimiter"], settings: { foreground: "#928e9b" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#f0814f" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#eac392" } },
  ],
};

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const lang = normalizeLang(language);
    if (!lang) {
      setHtml(null); // no language → plain mono (don't guess)
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { codeToHtml } = await import("shiki");
        const out = await codeToHtml(code, { lang, theme: THEME });
        if (!cancelled) setHtml(out);
      } catch {
        if (!cancelled) setHtml(null); // unsupported language / load failure → plain fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard unavailable (insecure context / denied) — silently no-op
    }
  }

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
      {/* Quiet header — a language label + a working copy button, no traffic-light dots. */}
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
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: 0,
            padding: "2px 4px",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: copied ? "var(--accent)" : "var(--text-faint)",
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      {html ? (
        <div
          className="rc-code"
          // SECURITY: shiki-produced HTML only (code was passed as escaped text) — never raw model HTML.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
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
      )}
    </div>
  );
}
