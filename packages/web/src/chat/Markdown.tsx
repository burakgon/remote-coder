import type { CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

/**
 * SECURITY: react-markdown does NOT render raw HTML embedded in the source by default (no
 * `rehype-raw` plugin is configured), so a `<script>` / `<img onerror>` payload in untrusted
 * model output is rendered as inert text, never as live DOM. Code blocks receive code as a text
 * prop, not HTML. Do not add `rehype-raw`/`dangerouslySetInnerHTML` without a sanitizer.
 *
 * `remark-gfm` enables GitHub-Flavored Markdown — tables, strikethrough, task lists, autolinks —
 * which plain CommonMark (react-markdown's default) does NOT support, so model output containing a
 * table previously rendered as raw pipe text instead of a table.
 */
const components: Components = {
  code({ className, children, ...props }) {
    const text = String(children).replace(/\n$/, "");
    const match = /language-(\w+)/.exec(className ?? "");
    // Fenced block (has a language class or contains a newline) → CodeBlock; else inline mono.
    if (match || text.includes("\n")) {
      return <CodeBlock code={text} language={match?.[1]} />;
    }
    return (
      <code
        {...props}
        style={{
          // Inline code (spec .msg code) — a quiet elevated surface + hairline, neutral mono text.
          fontFamily: "var(--font-mono)",
          fontSize: "0.86em",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          padding: "1px 5px",
          borderRadius: 5,
        }}
      >
        {children}
      </code>
    );
  },
  // `maxWidth: 100%` + `overflowX: auto` keep a wide table inside the message column and scroll it
  // INSIDE this box, instead of pushing the whole conversation off to the right. The Nebula table is
  // a glassy rounded surface: a hairline border + soft elevation, with a quiet surface-2 header band.
  table: ({ children }) => (
    <div
      style={{
        maxWidth: "100%",
        overflowX: "auto",
        margin: "var(--sp-2) 0",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-1)",
      }}
    >
      <table style={{ borderCollapse: "collapse", fontSize: "var(--fs-sm)", width: "100%" }}>{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th
      style={{
        ...style,
        borderBottom: "1px solid var(--border)",
        padding: "var(--sp-2) var(--sp-3)",
        background: "var(--surface-2)",
        textAlign: (style?.textAlign as "left" | "right" | "center" | undefined) ?? "left",
        fontFamily: "var(--font-display)",
        fontSize: "var(--fs-xs)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--text-muted)",
        fontWeight: 600,
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      style={{
        ...style,
        borderBottom: "1px solid var(--border)",
        padding: "var(--sp-2) var(--sp-3)",
        textAlign: (style?.textAlign as "left" | "right" | "center" | undefined) ?? "left",
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </td>
  ),
  // Links stay NEUTRAL (coral is reserved) — bright text + a quiet hairline underline.
  a: ({ children, href }) => (
    <a
      href={href}
      style={{ color: "var(--text)", textDecoration: "none", borderBottom: "1px solid var(--border-strong)" }}
    >
      {children}
    </a>
  ),
  // CodeBlock renders a <div>; without a passthrough `pre`, react-markdown wraps it in a <pre> (invalid
  // div-in-pre nesting + the default <pre>'s own margins boxing the card).
  pre: ({ children }) => <>{children}</>,
  // Markdown images scale to the column instead of overflowing at 390px; a broken src hides quietly.
  img: ({ src, alt }) => (
    <img
      src={typeof src === "string" ? src : undefined}
      alt={alt ?? ""}
      style={{ maxWidth: "100%", height: "auto", borderRadius: "var(--radius-sm)", display: "block" }}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  ),
  // Headings on the compact 15px scale: the display face, tight margins, sizes stepping down — not the
  // browser defaults (h1=2em) that clash with the body scale, and h4-h6 get the display face too.
  h1: ({ children }) => <h1 style={headingStyle("1.2rem")}>{children}</h1>,
  h2: ({ children }) => <h2 style={headingStyle("1.08rem")}>{children}</h2>,
  h3: ({ children }) => <h3 style={headingStyle("0.98rem")}>{children}</h3>,
  h4: ({ children }) => <h4 style={headingStyle("0.9rem")}>{children}</h4>,
  h5: ({ children }) => <h5 style={headingStyle("0.86rem")}>{children}</h5>,
  h6: ({ children }) => <h6 style={headingStyle("0.86rem")}>{children}</h6>,
};

function headingStyle(fontSize: string): CSSProperties {
  return {
    fontFamily: "var(--font-display)",
    fontWeight: 600,
    fontSize,
    lineHeight: 1.3,
    margin: "var(--sp-4) 0 var(--sp-2)",
  };
}

export interface MarkdownProps {
  children: string;
}

export function Markdown({ children }: MarkdownProps) {
  // overflow-wrap is inherited, so anywhere on this wrapper makes p/li/a/inline-code break a long
  // unbroken token or URL instead of forcing horizontal page scroll at 390px; min-width:0 lets the
  // block shrink inside a flex/grid message column.
  return (
    <div style={{ overflowWrap: "anywhere", minWidth: 0 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
