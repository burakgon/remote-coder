import { Icon } from "../ui/Icon";

export interface ConnectionBannerProps {
  online: boolean;
}

/**
 * A calm, hairline offline notice (Variant A). Pairs an alert glyph with text (never color alone)
 * and uses a restrained amber top edge rather than a loud filled banner. Renders nothing online.
 */
export function ConnectionBanner({ online }: ConnectionBannerProps) {
  if (online) return null;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-2)",
        background: "var(--surface-2)",
        borderBottom: "1px solid var(--accent)",
        color: "var(--text)",
        // Topmost element → clear the status bar / notch itself (the fill still extends behind it).
        padding: "calc(var(--sp-2) + env(safe-area-inset-top, 0px)) var(--sp-4) var(--sp-2)",
        fontSize: "var(--fs-sm)",
        textAlign: "center",
      }}
    >
      <Icon name="alert" size={15} style={{ color: "var(--accent)" }} />
      <span>Offline — the session keeps running on your machine; we’ll reconnect when the link returns.</span>
    </div>
  );
}
