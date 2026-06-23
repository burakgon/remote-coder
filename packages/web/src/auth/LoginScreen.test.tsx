import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginScreen } from "./LoginScreen";

describe("LoginScreen", () => {
  it("submits the entered token", async () => {
    const onAuth = vi.fn();
    render(<LoginScreen onAuthenticated={onAuth} />);
    await userEvent.type(screen.getByLabelText(/access token/i), "my-token");
    await userEvent.click(screen.getByRole("button", { name: /connect$/i }));
    expect(onAuth).toHaveBeenCalledWith("my-token");
  });

  it("shows an initial error (e.g. a prior 401)", () => {
    render(<LoginScreen onAuthenticated={vi.fn()} initialError="Invalid token (401)" />);
    expect(screen.getByText(/invalid token \(401\)/i)).toBeInTheDocument();
  });

  it("offers a tokenless local-dev connect", async () => {
    const onAuth = vi.fn();
    render(<LoginScreen onAuthenticated={onAuth} />);
    await userEvent.click(screen.getByRole("button", { name: /without a token/i }));
    expect(onAuth).toHaveBeenCalledWith("");
  });
});
