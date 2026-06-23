import type { ReactNode } from "react";

export interface MonoProps {
  children: ReactNode;
  muted?: boolean;
  className?: string;
}

export function Mono({ children, muted, className }: MonoProps) {
  return (
    <span
      className={className}
      style={{ fontFamily: "var(--font-mono)", color: muted ? "var(--text-muted)" : "inherit" }}
    >
      {children}
    </span>
  );
}
