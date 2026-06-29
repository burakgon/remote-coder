import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ClaudeAuthStatus } from "../types/server";

/**
 * Settings section to RE-AUTHENTICATE the server's Claude login from the app. When the server-side
 * subscription token expires, every turn fails with "Failed to authenticate. API Error: 401" and the only
 * fix used to be SSHing in to run `claude auth login`. This drives that flow in-app:
 *   1. "Sign in" → POST /auth/login/start returns an authorize URL.
 *   2. The user opens it in ANY browser, approves, and copies the code the callback page shows.
 *   3. Pastes the code → POST /auth/login/code finishes the exchange; the server saves fresh creds and
 *      turns work again (no restart).
 */
type Flow =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "code"; loginId: string; url: string; submitting: boolean }
  | { step: "done" }
  | { step: "error"; message: string };

export function ClaudeAuthSection({ api }: { api: ApiClient }) {
  const [status, setStatus] = useState<ClaudeAuthStatus | undefined>();
  const [flow, setFlow] = useState<Flow>({ step: "idle" });
  const [code, setCode] = useState("");

  const refreshStatus = () => {
    void api
      .getAuthStatus()
      .then(setStatus)
      .catch(() => setStatus({ available: false }));
  };
  useEffect(refreshStatus, [api]);

  // The feature is off on this server (no claude bin) — render nothing rather than a dead control.
  if (status && !status.available) return null;

  const start = () => {
    setFlow({ step: "starting" });
    setCode("");
    api
      .startAuthLogin()
      .then(({ loginId, url }) => setFlow({ step: "code", loginId, url, submitting: false }))
      .catch((e: unknown) =>
        setFlow({ step: "error", message: e instanceof Error ? e.message : "Couldn't start sign-in." }),
      );
  };

  const submit = () => {
    if (flow.step !== "code" || code.trim() === "") return;
    const { loginId } = flow;
    setFlow({ ...flow, submitting: true });
    api
      .submitAuthCode(loginId, code.trim())
      .then((r) => {
        if (r.ok) {
          setFlow({ step: "done" });
          setCode("");
          refreshStatus();
        } else {
          setFlow({ step: "error", message: r.message ?? "Sign-in failed." });
        }
      })
      .catch((e: unknown) => setFlow({ step: "error", message: e instanceof Error ? e.message : "Sign-in failed." }));
  };

  const cancel = () => {
    void api.cancelAuthLogin().catch(() => {});
    setFlow({ step: "idle" });
    setCode("");
  };

  const signedIn = status?.loggedIn;
  const account = status?.email
    ? `${status.email}${status.subscriptionType ? ` · ${status.subscriptionType}` : ""}`
    : undefined;

  return (
    <div className="rc-settings__field" style={{ display: "grid", gap: "var(--sp-2)" }}>
      <span className="rc-settings__field-label">Claude account</span>

      <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
        {status === undefined
          ? "Checking…"
          : signedIn
            ? `Signed in${account ? ` as ${account}` : ""}.`
            : "Not signed in."}
      </div>
      <p className="rc-settings__hint" style={{ margin: 0 }}>
        If turns fail with “Failed to authenticate · 401”, the server&apos;s Claude login expired — sign in again here
        (no SSH needed).
      </p>

      {flow.step === "code" ? (
        <div style={{ display: "grid", gap: "var(--sp-2)" }}>
          <a
            href={flow.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rc-settings__secondary"
            style={{ textAlign: "center", textDecoration: "none" }}
          >
            Open the Claude sign-in page ↗
          </a>
          <p className="rc-settings__hint" style={{ margin: 0 }}>
            Approve access in the page that opens, then paste the code it shows below.
          </p>
          <input
            aria-label="authorization code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste the code here"
            className="rc-settings__control rc-settings__control--mono"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end" }}>
            <button type="button" className="rc-settings__secondary" onClick={cancel} disabled={flow.submitting}>
              Cancel
            </button>
            <button
              type="button"
              className="rc-settings__primary"
              onClick={submit}
              disabled={flow.submitting || code.trim() === ""}
            >
              {flow.submitting ? "Signing in…" : "Submit code"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "var(--sp-2)" }}>
          {flow.step === "done" && (
            <div role="status" style={{ color: "var(--ok)", fontSize: "var(--fs-sm)" }}>
              Signed in ✓
            </div>
          )}
          {flow.step === "error" && (
            <div role="alert" style={{ color: "var(--err)", fontSize: "var(--fs-sm)", overflowWrap: "anywhere" }}>
              {flow.message}
            </div>
          )}
          <button
            type="button"
            className="rc-settings__secondary"
            onClick={start}
            disabled={flow.step === "starting"}
            style={{ justifySelf: "start" }}
          >
            {flow.step === "starting" ? "Starting…" : signedIn ? "Re-authenticate" : "Sign in"}
          </button>
        </div>
      )}
    </div>
  );
}
