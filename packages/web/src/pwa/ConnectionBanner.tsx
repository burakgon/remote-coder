export interface ConnectionBannerProps {
  online: boolean;
}

export function ConnectionBanner({ online }: ConnectionBannerProps) {
  if (online) return null;
  return (
    <div
      role="status"
      style={{
        background: "var(--surface-2)",
        borderBottom: "2px solid var(--accent)",
        color: "var(--text)",
        padding: "var(--sp-2) var(--sp-4)",
        fontSize: "var(--fs-sm)",
        textAlign: "center",
      }}
    >
      Offline — the session keeps running on your machine; we’ll reconnect when the link returns.
    </div>
  );
}
