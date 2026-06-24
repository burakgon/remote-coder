import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ResumePicker } from "./ResumePicker";
import type { ResumableSession } from "../types/server";

const NOW = 1_000_000_000_000;

// Server returns recent-first; we keep that order. `lastActivity` descends.
const rows: ResumableSession[] = [
  {
    sessionId: "s-recent",
    cwd: "/home/u/alpha",
    gitBranch: "main",
    summary: "Add the resume picker",
    lastActivity: NOW - 60_000, // 1m ago
    messageCount: 12,
  },
  {
    sessionId: "s-older",
    cwd: "/home/u/beta",
    summary: "Fix the websocket reconnect",
    lastActivity: NOW - 7_200_000, // 2h ago
    messageCount: 3,
  },
];

function makeGet(result: ResumableSession[] = rows) {
  return vi.fn<(cwd?: string) => Promise<ResumableSession[]>>(() => Promise.resolve(result));
}

describe("ResumePicker", () => {
  it("renders resumable rows recent-first with summary, relative time, and message count", async () => {
    render(<ResumePicker getResumable={makeGet()} now={NOW} onResume={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => screen.getByText("Add the resume picker"));

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // Recent-first: the 1m-ago row is first.
    expect(within(items[0]!).getByText("Add the resume picker")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Fix the websocket reconnect")).toBeInTheDocument();

    // Relative time + count surface.
    expect(screen.getByText("1m")).toBeInTheDocument();
    expect(screen.getByText("12 msg")).toBeInTheDocument();
    // git branch shows when present.
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("filters the list by summary via the search field", async () => {
    render(<ResumePicker getResumable={makeGet()} now={NOW} onResume={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => screen.getByText("Add the resume picker"));
    await userEvent.type(screen.getByRole("textbox", { name: /search past sessions/i }), "websocket");
    expect(screen.queryByText("Add the resume picker")).not.toBeInTheDocument();
    expect(screen.getByText("Fix the websocket reconnect")).toBeInTheDocument();
  });

  it("filters by cwd path too", async () => {
    render(<ResumePicker getResumable={makeGet()} now={NOW} onResume={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => screen.getByText("Add the resume picker"));
    await userEvent.type(screen.getByRole("textbox", { name: /search past sessions/i }), "beta");
    expect(screen.queryByText("Add the resume picker")).not.toBeInTheDocument();
    expect(screen.getByText("Fix the websocket reconnect")).toBeInTheDocument();
  });

  it("calls onResume with the chosen sessionId when a row is tapped", async () => {
    const onResume = vi.fn(() => Promise.resolve());
    render(<ResumePicker getResumable={makeGet()} now={NOW} onResume={onResume} onCancel={vi.fn()} />);
    await waitFor(() => screen.getByText("Add the resume picker"));
    await userEvent.click(screen.getByRole("button", { name: /resume add the resume picker/i }));
    await waitFor(() => expect(onResume).toHaveBeenCalledWith("s-recent"));
  });

  it("shows an inline error when a resume rejects (e.g. 404)", async () => {
    const onResume = vi.fn(() => Promise.reject(new Error("no transcript (404)")));
    render(<ResumePicker getResumable={makeGet()} now={NOW} onResume={onResume} onCancel={vi.fn()} />);
    await waitFor(() => screen.getByText("Add the resume picker"));
    await userEvent.click(screen.getByRole("button", { name: /resume add the resume picker/i }));
    expect(await screen.findByText(/no transcript \(404\)/i)).toBeInTheDocument();
  });

  it("shows the scoped empty state when a cwd has no past sessions", async () => {
    render(
      <ResumePicker
        getResumable={makeGet([])}
        scopeCwd="/home/u/alpha"
        now={NOW}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(await screen.findByText(/no past sessions in alpha/i)).toBeInTheDocument();
  });

  it("shows the global empty state when there are no past sessions at all", async () => {
    render(<ResumePicker getResumable={makeGet([])} now={NOW} onResume={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByText(/no past sessions yet/i)).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    const failing = vi.fn<(cwd?: string) => Promise<ResumableSession[]>>(() =>
      Promise.reject(new Error("server down")),
    );
    render(<ResumePicker getResumable={failing} now={NOW} onResume={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByText(/server down/i)).toBeInTheDocument();
  });

  it("defaults to the scoped cwd and re-fetches all when 'All' is chosen", async () => {
    const getResumable = makeGet();
    render(
      <ResumePicker
        getResumable={getResumable}
        scopeCwd="/home/u/alpha"
        now={NOW}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => expect(getResumable).toHaveBeenCalledWith("/home/u/alpha"));
    await userEvent.click(screen.getByRole("button", { name: /^all$/i }));
    await waitFor(() => expect(getResumable).toHaveBeenCalledWith(undefined));
  });
});
