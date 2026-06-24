import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SessionList } from "./SessionList";
import type { SessionMeta } from "../types/server";

const sessions: SessionMeta[] = [
  { id: "s1", cwd: "/home/u/remote-coder", model: "opus", effort: "high", dangerouslySkip: false, status: "running", createdAt: 1 },
  { id: "s2", cwd: "/home/u/notes", dangerouslySkip: false, status: "stopped", createdAt: 2 },
];

describe("SessionList", () => {
  it("renders a row per session with its cwd basename and mono path", () => {
    render(<SessionList sessions={sessions} onSelect={vi.fn()} onNew={vi.fn()} viewWireState={() => "idle"} />);
    expect(screen.getByText("remote-coder")).toBeInTheDocument();
    expect(screen.getByText("notes")).toBeInTheDocument();
    expect(screen.getByText("/home/u/remote-coder")).toBeInTheDocument();
  });

  it("surfaces the model·effort meta and the live status for a row", () => {
    render(
      <SessionList sessions={sessions} onSelect={vi.fn()} onNew={vi.fn()} viewWireState={(id) => (id === "s1" ? "running-tool" : "idle")} />,
    );
    // The card shows the session's model + effort so it's scannable at a glance.
    expect(screen.getByText("opus")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    // The LiveWire status reads its label out (color is never the sole signal).
    expect(screen.getByText("Running tool")).toBeInTheDocument();
  });

  it("marks the active row with aria-current for a clear selected state", () => {
    render(
      <SessionList sessions={sessions} activeId="s1" onSelect={vi.fn()} onNew={vi.fn()} viewWireState={() => "idle"} />,
    );
    const active = screen.getByRole("button", { name: /remote-coder/i });
    expect(active).toHaveAttribute("aria-current", "true");
  });

  it("calls onSelect when a row is activated", async () => {
    const onSelect = vi.fn();
    render(<SessionList sessions={sessions} onSelect={onSelect} onNew={vi.fn()} viewWireState={() => "idle"} />);
    await userEvent.click(screen.getByText("remote-coder"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("calls onNew from the New session icon button (reachable by aria-label)", async () => {
    const onNew = vi.fn();
    render(<SessionList sessions={sessions} onSelect={vi.fn()} onNew={onNew} viewWireState={() => "idle"} />);
    // The affordance is an icon button, not a text button — it's reached by its accessible name.
    await userEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(onNew).toHaveBeenCalled();
  });

  it("renders an empty state with a single New session affordance and no row buttons", () => {
    render(<SessionList sessions={[]} onSelect={vi.fn()} onNew={vi.fn()} viewWireState={() => "idle"} />);
    expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument();
    // The empty state must not duplicate a second "New session" button (the header has the only one).
    expect(screen.getAllByRole("button", { name: "New session" })).toHaveLength(1);
  });
});
