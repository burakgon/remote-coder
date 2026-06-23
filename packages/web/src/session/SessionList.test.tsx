import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SessionList } from "./SessionList";
import type { SessionMeta } from "../types/server";

const sessions: SessionMeta[] = [
  { id: "s1", cwd: "/home/u/remote-coder", dangerouslySkip: false, status: "running", createdAt: 1 },
  { id: "s2", cwd: "/home/u/notes", dangerouslySkip: false, status: "stopped", createdAt: 2 },
];

describe("SessionList", () => {
  it("renders a row per session with its cwd basename and mono path", () => {
    render(<SessionList sessions={sessions} onSelect={vi.fn()} onNew={vi.fn()} viewWireState={() => "idle"} />);
    expect(screen.getByText("remote-coder")).toBeInTheDocument();
    expect(screen.getByText("notes")).toBeInTheDocument();
    expect(screen.getByText("/home/u/remote-coder")).toBeInTheDocument();
  });

  it("calls onSelect when a row is activated", async () => {
    const onSelect = vi.fn();
    render(<SessionList sessions={sessions} onSelect={onSelect} onNew={vi.fn()} viewWireState={() => "idle"} />);
    await userEvent.click(screen.getByText("remote-coder"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("calls onNew from the New session button", async () => {
    const onNew = vi.fn();
    render(<SessionList sessions={sessions} onSelect={vi.fn()} onNew={onNew} viewWireState={() => "idle"} />);
    await userEvent.click(screen.getByRole("button", { name: /new session/i }));
    expect(onNew).toHaveBeenCalled();
  });
});
