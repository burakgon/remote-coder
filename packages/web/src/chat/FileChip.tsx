import { Mono } from "../ui/Mono";

export interface FileChipProps {
  path: string;
  href: string;
}

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

export function FileChip({ path, href }: FileChipProps) {
  return (
    <a
      href={href}
      download
      title={path}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        minHeight: "var(--tap-min)",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "2px var(--sp-3)",
        color: "var(--text)",
        textDecoration: "none",
      }}
    >
      <span aria-hidden>⤓</span>
      <Mono>{basename(path)}</Mono>
    </a>
  );
}
