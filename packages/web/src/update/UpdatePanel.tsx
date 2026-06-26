import { useRef } from "react";
import type { CSSProperties } from "react";
import { Icon } from "../ui/Icon";
import { useFocusTrap } from "../ui/useFocusTrap";
import type { ChangelogEntry, UpdateStatus, VersionInfo } from "../types/server";
import type { UpdateUxState } from "../store/store";

export interface UpdatePanelProps {
  info: VersionInfo;
  /** idle = show the changelog + "Update now"; updating = show the live progress overlay; failed =
   * show the error + Retry. */
  state: UpdateUxState;
  /** The server-reported updater status (for the updating overlay's phase + a failure message). */
  status?: UpdateStatus;
  /** Confirm + apply the update (POST /update). */
  onUpdate: () => void;
  /** Dismiss the panel (Later / Escape / backdrop). */
  onClose: () => void;
}

const GROUP_LABELS: Record<ChangelogEntry["group"], string> = {
  new: "New",
  fixes: "Fixes",
  improvements: "Improvements",
  other: "Other",
};
const GROUP_ORDER: ChangelogEntry["group"][] = ["new", "fixes", "improvements", "other"];

/** Map an updater state to a short, human progress label for the updating overlay. */
const PHASE_LABEL: Record<string, string> = {
  starting: "Starting…",
  pulling: "Pulling the latest code…",
  installing: "Installing dependencies…",
  building: "Building…",
  restarting: "Restarting…",
  done: "Restarting…",
};

/**
 * The "What's new" / update sheet — a floating-glass bottom sheet (the `.rc-glass--float` material,
 * mirroring RewindSheet) showing the current→new version, the grouped changelog (New / Fixes /
 * Improvements) with relative dates, and the primary "Update now" action with a plain-language confirm
 * blurb. While updating it swaps to a live progress overlay; on failure it shows the error + Retry.
 *
 * Tokens only, no emoji (icons via <Icon>), focus-trapped + Escape-to-close, reduced-motion safe (the
 * entrance rise references a global keyframe neutralized under prefers-reduced-motion).
 */
export function UpdatePanel({ info, state, status, onUpdate, onClose }: UpdatePanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef as React.RefObject<HTMLElement>, true);

  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    label: GROUP_LABELS[g],
    items: info.changelog.filter((c) => c.group === g),
  })).filter((s) => s.items.length > 0);

  const updating = state === "updating";
  const failed = state === "failed";

  return (
    <div
      role="presentation"
      onClick={(e) => {
        // Don't let a backdrop tap dismiss mid-update (the work continues server-side regardless, but
        // closing would lose the progress view). Only the idle/failed states are dismissible by backdrop.
        if (e.target === e.currentTarget && !updating) onClose();
      }}
      style={BACKDROP}
    >
      <div
        ref={dialogRef}
        className="rc-glass--float"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        onKeyDown={(e) => {
          // Escape always closes — even while updating: the server work continues, the modal just hides
          // (so a hung/never-restarting update can't trap the user). App keeps polling + ends the flow.
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        style={SHEET}
      >
        <div style={HEADER}>
          <span aria-hidden style={{ display: "inline-flex", color: "var(--coral)" }}>
            <Icon name="download" size={18} />
          </span>
          <span id="update-title" style={TITLE}>
            {failed ? "Update failed" : updating ? "Updating…" : "Update available"}
          </span>
        </div>

        {/* current → new version (mono labels). */}
        <div style={VERSION_ROW}>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>
            {info.current}
          </span>
          <span aria-hidden style={{ color: "var(--text-faint)" }}>
            <Icon name="chevron-right" size={14} />
          </span>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)", fontSize: "var(--fs-sm)" }}>
            {info.latest}
          </span>
        </div>

        {updating ? (
          <UpdatingBody status={status} />
        ) : failed ? (
          <FailedBody status={status} />
        ) : (
          <>
            {grouped.length > 0 ? (
              <div style={{ display: "grid", gap: "var(--sp-4)", maxHeight: "46vh", overflowY: "auto" }}>
                {grouped.map((section) => (
                  <div key={section.group} style={{ display: "grid", gap: "var(--sp-2)" }}>
                    <div style={SECTION_LABEL}>{section.label}</div>
                    <ul style={LIST}>
                      {section.items.map((c) => (
                        <li key={c.sha} style={LIST_ITEM}>
                          <span style={{ color: "var(--text)", lineHeight: 1.45 }}>{c.subject}</span>
                          {c.when && (
                            <span
                              style={{
                                flex: "none",
                                fontFamily: "var(--font-mono)",
                                fontSize: "var(--fs-xs)",
                                color: "var(--text-faint)",
                              }}
                            >
                              {c.when}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>
                {info.behind} {info.behind === 1 ? "change" : "changes"} are available.
              </p>
            )}

            <p style={CONFIRM_BLURB}>
              This pulls the latest code, rebuilds, and restarts the server. Running turns are interrupted and resume
              after the restart.
            </p>
          </>
        )}

        <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end" }}>
          {updating ? (
            // Updating keeps running server-side; "Hide" just dismisses the overlay so a hung update can't
            // trap the user with no closable control. App's status poll finishes the flow + shows the toast.
            <button type="button" onClick={onClose} style={LATER_BTN}>
              Hide
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} style={LATER_BTN}>
                Later
              </button>
              <button type="button" onClick={onUpdate} style={UPDATE_BTN}>
                {failed ? "Retry" : "Update now"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The live progress overlay shown while updating. */
function UpdatingBody({ status }: { status?: UpdateStatus }) {
  const phase = status?.state ?? "starting";
  const label = PHASE_LABEL[phase] ?? "Updating…";
  return (
    <div role="status" aria-live="polite" style={{ display: "grid", gap: "var(--sp-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <span aria-hidden className="rc-update-spin" style={SPINNER} />
        <span style={{ color: "var(--text)" }}>{label}</span>
      </div>
      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--fs-sm)", lineHeight: 1.45 }}>
        Pulling → building → restarting. The app reconnects automatically when the new version is up.
      </p>
      {/* The spinner uses a global-ish keyframe defined inline; neutralized under reduced-motion. */}
      <style>{`
        @keyframes rc-update-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .rc-update-spin { animation: none !important; } }
      `}</style>
    </div>
  );
}

/** The failure body — the updater's error + last log lines. */
function FailedBody({ status }: { status?: UpdateStatus }) {
  return (
    <div style={{ display: "grid", gap: "var(--sp-3)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
        <span aria-hidden style={{ display: "inline-flex", color: "var(--err)", flex: "none", marginTop: 2 }}>
          <Icon name="alert" size={16} />
        </span>
        <span style={{ color: "var(--text)", lineHeight: 1.45 }}>
          {status?.error ?? "The update didn't complete. The previous version is still running."}
        </span>
      </div>
      {status?.log && (
        <pre style={LOG_BOX}>
          <code>{status.log}</code>
        </pre>
      )}
    </div>
  );
}

const BACKDROP: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 55,
  display: "grid",
  placeItems: "end center",
  padding: "var(--sp-4)",
  paddingBottom: "max(var(--sp-4), env(safe-area-inset-bottom))",
  background: "var(--scrim, rgba(0,0,0,0.45))",
};

const SHEET: CSSProperties = {
  width: "min(480px, 100%)",
  // Cap to the viewport (minus the backdrop padding) and scroll, so on a short phone a long changelog
  // doesn't push the header/title above the top of the screen (the sheet is bottom-aligned).
  maxHeight: "calc(100dvh - 2 * var(--sp-4))",
  overflowY: "auto",
  borderRadius: "var(--radius)",
  padding: "var(--sp-4)",
  display: "grid",
  gap: "var(--sp-4)",
  animation: "rc-rise 0.28s ease-out",
};

const HEADER: CSSProperties = { display: "flex", alignItems: "center", gap: "var(--sp-2)" };

const TITLE: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: "var(--fs-lg, var(--fs-base))",
  color: "var(--text)",
  letterSpacing: "0.01em",
};

const VERSION_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  flexWrap: "wrap",
};

const SECTION_LABEL: CSSProperties = {
  fontSize: "var(--fs-xs)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-muted)",
  fontWeight: 600,
};

const LIST: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--sp-2)" };

const LIST_ITEM: CSSProperties = {
  display: "flex",
  gap: "var(--sp-3)",
  alignItems: "baseline",
  justifyContent: "space-between",
  fontSize: "var(--fs-sm)",
};

const CONFIRM_BLURB: CSSProperties = {
  margin: 0,
  color: "var(--text-muted)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.45,
};

const LATER_BTN: CSSProperties = {
  minHeight: "var(--tap-min)",
  padding: "0 var(--sp-4)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "transparent",
  color: "var(--text)",
  fontWeight: 500,
  cursor: "pointer",
};

const UPDATE_BTN: CSSProperties = {
  // The single coral primary — a FLAT coral fill, dark ink label. No glow.
  minHeight: "var(--tap-min)",
  padding: "0 var(--sp-4)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid transparent",
  background: "var(--accent-grad)",
  color: "var(--on-accent)",
  fontWeight: 600,
  cursor: "pointer",
};

const SPINNER: CSSProperties = {
  width: 18,
  height: 18,
  flex: "none",
  borderRadius: "50%",
  border: "2px solid var(--border-strong)",
  borderTopColor: "var(--coral)",
  animation: "rc-update-spin 0.8s linear infinite",
};

const LOG_BOX: CSSProperties = {
  margin: 0,
  padding: "var(--sp-3)",
  background: "var(--code-bg)",
  border: "1px solid var(--code-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--code-text)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-xs)",
  lineHeight: 1.5,
  maxHeight: "30vh",
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
