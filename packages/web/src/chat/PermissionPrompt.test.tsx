import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PermissionPrompt } from "./PermissionPrompt";
import type { PermissionPayload } from "../types/server";

const perm: PermissionPayload = {
  requestId: "r1",
  kind: "hook_callback",
  toolName: "Write",
  toolInput: { file_path: "/tmp/a.txt" },
};

describe("PermissionPrompt", () => {
  it("shows the tool name + input and announces an awaiting region", () => {
    render(<PermissionPrompt permission={perm} onAnswer={vi.fn()} />);
    expect(screen.getByRole("region", { name: /permission request/i })).toBeInTheDocument();
    expect(screen.getByText("Write")).toBeInTheDocument();
    expect(screen.getByText("/tmp/a.txt")).toBeInTheDocument();
    // The iris color is paired with the "Awaiting you" TEXT (color is never the sole signal).
    expect(screen.getByText(/awaiting you/i)).toBeInTheDocument();
  });

  it("answers allow and deny (decision only — no reason payload)", async () => {
    const onAnswer = vi.fn();
    render(<PermissionPrompt permission={perm} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole("button", { name: /^allow$/i }));
    expect(onAnswer).toHaveBeenCalledWith("allow");
    await userEvent.click(screen.getByRole("button", { name: /^deny$/i }));
    expect(onAnswer).toHaveBeenCalledWith("deny");
  });

  it("for AskUserQuestion, shows the question text but still only allow/deny", () => {
    const ask: PermissionPayload = {
      requestId: "r2",
      kind: "hook_callback",
      toolName: "AskUserQuestion",
      toolInput: { question: "Which database should I use?" },
    };
    render(<PermissionPrompt permission={ask} onAnswer={vi.fn()} />);
    expect(screen.getByText("AskUserQuestion")).toBeInTheDocument();
    expect(screen.getByText(/which database should i use/i)).toBeInTheDocument();
    // It is a permission gate, not a multi-option answerer: only Allow + Deny.
    expect(screen.getByRole("button", { name: /^allow$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^deny$/i })).toBeInTheDocument();
    // It must NOT render a multi-option answer UI — exactly the two gate buttons, nothing per-option.
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("is announced as an alertdialog and moves focus to itself when it appears", () => {
    render(<PermissionPrompt permission={perm} onAnswer={vi.fn()} />);
    const region = screen.getByRole("region", { name: /permission request/i });
    // Focus moves to the prompt so a keyboard / screen-reader user lands on it (Claude is waiting).
    expect(region).toHaveFocus();
  });

  it("offers an Always-allow control that answers allow AND registers a per-session rule", async () => {
    const onAnswer = vi.fn();
    const onAlwaysAllow = vi.fn();
    render(<PermissionPrompt permission={perm} onAnswer={onAnswer} onAlwaysAllow={onAlwaysAllow} />);
    await userEvent.click(screen.getByRole("button", { name: /always allow/i }));
    // It both answers the current prompt (allow) and remembers the tool for the session.
    expect(onAnswer).toHaveBeenCalledWith("allow");
    expect(onAlwaysAllow).toHaveBeenCalledWith("Write");
  });

  it("hides the Always-allow control when no onAlwaysAllow handler is provided", () => {
    render(<PermissionPrompt permission={perm} onAnswer={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /always allow/i })).not.toBeInTheDocument();
  });
});
