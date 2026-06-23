import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { saveToken, loadToken } from "./auth/token-store";
import { useStore } from "./store/store";

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  localStorage.clear();
  // Reset the shared zustand singleton so tests don't leak state into each other.
  useStore.setState({ token: undefined, sessions: [], activeSessionId: undefined, views: {} });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("App token validation on load", () => {
  it("with a stored token, validates via GET /sessions (200) and renders the session list", async () => {
    saveToken("good-token");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        sessions: [
          { id: "s1", cwd: "/home/u/remote-coder", dangerouslySkip: false, status: "running", createdAt: 1 },
        ],
      }),
    );

    render(<App />);

    // The validated session shows up in the list (proof we hit /sessions and stored the result).
    expect(await screen.findByText("remote-coder")).toBeInTheDocument();
    // It fetched /sessions with the stored bearer token.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/sessions$/);
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer good-token" });
    // Token survives a successful validation.
    expect(loadToken()).toBe("good-token");
  });

  it("on a 401, clears the stored token and returns to the login screen", async () => {
    saveToken("bad-token");
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));

    render(<App />);

    // Back at login, surfacing the 401.
    expect(await screen.findByText(/invalid token \(401\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument();
    // The bad token was cleared from storage.
    expect(loadToken()).toBeUndefined();
  });

  it("with no stored token, shows the login screen without calling the server", () => {
    render(<App />);
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
