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

  it("renders the iris card title 'Claude wants to run <Tool>' with the tool shown in mono", () => {
    const bash: PermissionPayload = {
      requestId: "r3",
      kind: "hook_callback",
      toolName: "Bash",
      toolInput: { command: "ls -la" },
    };
    render(<PermissionPrompt permission={bash} onAnswer={vi.fn()} />);
    expect(screen.getByText(/claude wants to run/i)).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    // The command appears in the mono detail panel.
    const cmd = screen.getByText("ls -la");
    expect(cmd.style.fontFamily).toContain("--font-mono");
    // A benign command is NOT tinted as an error.
    expect(cmd.style.color).not.toContain("--err");
  });

  it("tints a destructive command (rm -rf) with the error treatment", () => {
    const danger: PermissionPayload = {
      requestId: "r4",
      kind: "hook_callback",
      toolName: "Bash",
      toolInput: { command: "rm -rf build" },
    };
    render(<PermissionPrompt permission={danger} onAnswer={vi.fn()} />);
    const cmd = screen.getByText("rm -rf build");
    // The dangerous command is colored + backed by the --err token (mockup's rm -rf treatment).
    expect(cmd.style.color).toContain("--err");
    expect(cmd.style.background).toContain("--err");
  });

  it("shows an Edit as a ±diff so the user sees WHAT they're approving (not just 'Allow Edit')", () => {
    const edit: PermissionPayload = {
      requestId: "r5",
      kind: "hook_callback",
      toolName: "Edit",
      toolInput: { file_path: "/x/a.ts", old_string: "const a = 1;", new_string: "const a = 2;" },
    };
    render(<PermissionPrompt permission={edit} onAnswer={vi.fn()} />);
    expect(screen.getByText("/x/a.ts")).toBeInTheDocument();
    expect(screen.getByText("const a = 1;")).toBeInTheDocument(); // removed line
    expect(screen.getByText("const a = 2;")).toBeInTheDocument(); // added line
  });

  it("shows the active permission mode as a chip (not for default/bypass)", () => {
    const { rerender } = render(<PermissionPrompt permission={perm} onAnswer={vi.fn()} permissionMode="acceptEdits" />);
    expect(screen.getByText(/mode: acceptEdits/i)).toBeInTheDocument();
    rerender(<PermissionPrompt permission={perm} onAnswer={vi.fn()} permissionMode="default" />);
    expect(screen.queryByText(/mode:/i)).not.toBeInTheDocument();
  });
});
