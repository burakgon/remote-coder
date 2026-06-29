import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClaudeAuthSection } from "./ClaudeAuthSection";
import type { ApiClient } from "../api/client";

function mockApi(over: Partial<ApiClient>): ApiClient {
  return over as ApiClient;
}

describe("ClaudeAuthSection", () => {
  it("renders nothing when the feature is unavailable on the server", async () => {
    const getAuthStatus = vi.fn().mockResolvedValue({ available: false });
    const { container } = render(<ClaudeAuthSection api={mockApi({ getAuthStatus })} />);
    await waitFor(() => expect(getAuthStatus).toHaveBeenCalled());
    expect(container.querySelector(".rc-auth")).toBeNull();
  });

  it("shows the signed-in account", async () => {
    const getAuthStatus = vi
      .fn()
      .mockResolvedValue({ available: true, loggedIn: true, email: "a@b.com", subscriptionType: "max" });
    render(<ClaudeAuthSection api={mockApi({ getAuthStatus })} />);
    expect(await screen.findByText(/signed in as a@b\.com · max/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-authenticate/i })).toBeInTheDocument();
  });

  it("drives the full sign-in flow: start → show URL + code field → submit → signed in", async () => {
    const getAuthStatus = vi
      .fn()
      .mockResolvedValueOnce({ available: true, loggedIn: false }) // initial
      .mockResolvedValue({ available: true, loggedIn: true, email: "a@b.com" }); // after sign-in
    const startAuthLogin = vi
      .fn()
      .mockResolvedValue({ loginId: "L1", url: "https://claude.com/cai/oauth/authorize?code=true" });
    const submitAuthCode = vi.fn().mockResolvedValue({ ok: true });
    render(<ClaudeAuthSection api={mockApi({ getAuthStatus, startAuthLogin, submitAuthCode })} />);

    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));

    // The authorize URL is offered as a link, and a code field appears.
    const link = await screen.findByRole("link", { name: /open the claude sign-in page/i });
    expect(link).toHaveAttribute("href", "https://claude.com/cai/oauth/authorize?code=true");
    const input = screen.getByLabelText(/authorization code/i);
    await userEvent.type(input, "PASTED-CODE");
    await userEvent.click(screen.getByRole("button", { name: /submit code/i }));

    expect(submitAuthCode).toHaveBeenCalledWith("L1", "PASTED-CODE");
    expect(await screen.findByText(/signed in ✓/i)).toBeInTheDocument();
  });

  it("surfaces a failed sign-in message", async () => {
    const getAuthStatus = vi.fn().mockResolvedValue({ available: true, loggedIn: false });
    const startAuthLogin = vi.fn().mockResolvedValue({ loginId: "L1", url: "https://claude.com/cai/oauth/authorize" });
    const submitAuthCode = vi.fn().mockResolvedValue({ ok: false, message: "Invalid authorization code" });
    render(<ClaudeAuthSection api={mockApi({ getAuthStatus, startAuthLogin, submitAuthCode })} />);

    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));
    await userEvent.type(await screen.findByLabelText(/authorization code/i), "BAD");
    await userEvent.click(screen.getByRole("button", { name: /submit code/i }));

    expect(await screen.findByText(/invalid authorization code/i)).toBeInTheDocument();
  });
});
