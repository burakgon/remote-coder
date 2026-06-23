import { useState } from "react";
import { Surface } from "../ui/Surface";
import { Button } from "../ui/Button";

export interface LoginScreenProps {
  onAuthenticated: (token: string) => void;
  initialError?: string;
}

export function LoginScreen({ onAuthenticated, initialError }: LoginScreenProps) {
  const [token, setToken] = useState("");
  return (
    <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: "var(--sp-5)" }}>
      <Surface level={1} as="section">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAuthenticated(token);
          }}
          style={{ padding: "var(--sp-5)", display: "grid", gap: "var(--sp-4)", width: "min(92vw, 420px)" }}
        >
          <div className="display" style={{ fontSize: "var(--fs-2xl)" }}>remote-coder</div>
          <p style={{ color: "var(--text-muted)", margin: 0, fontSize: "var(--fs-sm)" }}>
            Enter the access token from your server to connect.
          </p>
          {initialError && (
            <div role="alert" style={{ color: "var(--err)", fontSize: "var(--fs-sm)" }}>{initialError}</div>
          )}
          <label style={{ display: "grid", gap: "var(--sp-2)" }}>
            <span style={{ fontSize: "var(--fs-sm)" }}>Access token</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              style={{ minHeight: "var(--tap-min)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)", padding: "0 var(--sp-3)", fontFamily: "var(--font-mono)" }}
            />
          </label>
          <Button type="submit" variant="primary">Connect</Button>
          <Button type="button" variant="ghost" onClick={() => onAuthenticated("")}>
            Connect without a token (local dev)
          </Button>
          <p style={{ color: "var(--text-muted)", margin: 0, fontSize: "var(--fs-xs)" }}>
            The token is stored in this browser only (localStorage).
          </p>
        </form>
      </Surface>
    </div>
  );
}
