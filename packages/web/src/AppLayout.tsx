import type { ReactNode } from "react";

export interface AppLayoutProps {
  children: ReactNode;
  sessionList: ReactNode;
  onShowSessions?: () => void;
  sessionsOpen?: boolean;
}

/**
 * Mission-control responsive shell. Desktop (≥768px): left rail + right conversation.
 * Mobile: conversation full-bleed; the session list lives in a bottom sheet toggled by
 * `sessionsOpen`. Layout is CSS-driven (media query in the inline <style>).
 */
export function AppLayout({ children, sessionList, sessionsOpen }: AppLayoutProps) {
  return (
    <div className="rc-shell">
      <aside className="rc-rail" data-open={sessionsOpen ? "true" : "false"}>{sessionList}</aside>
      <main className="rc-main">{children}</main>
      <style>{`
        .rc-shell { height: 100%; display: flex; flex-direction: column; }
        .rc-main { flex: 1; min-height: 0; overflow-y: auto; }
        .rc-rail { background: var(--surface); border-bottom: 1px solid var(--border); max-height: 70vh; overflow-y: auto; }
        /* Mobile: rail is a bottom sheet shown only when open. */
        .rc-rail[data-open="false"] { display: none; }
        @media (min-width: 768px) {
          .rc-shell { flex-direction: row; }
          .rc-rail { width: var(--rail-w); max-height: none; height: 100%; border-bottom: none; border-right: 1px solid var(--border); display: block; }
        }
      `}</style>
    </div>
  );
}
