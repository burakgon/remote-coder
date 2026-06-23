import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { CodeBlock } from "./CodeBlock";

/**
 * SECURITY: react-markdown does NOT render raw HTML embedded in the source by default (no
 * `rehype-raw` plugin is configured), so a `<script>` / `<img onerror>` payload in untrusted
 * model output is rendered as inert text, never as live DOM. Code blocks receive code as a text
 * prop, not HTML. Do not add `rehype-raw`/`dangerouslySetInnerHTML` without a sanitizer.
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
        style={{ fontFamily: "var(--font-mono)", background: "var(--surface-2)", padding: "0 4px", borderRadius: 4 }}
      >
        {children}
      </code>
    );
  },
};

export interface MarkdownProps {
  children: string;
}

export function Markdown({ children }: MarkdownProps) {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
}
