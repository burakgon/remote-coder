import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UpdatePanel } from "./UpdatePanel";
import type { ChangelogEntry, VersionInfo } from "../types/server";

function info(changelog: ChangelogEntry[] = []): VersionInfo {
  return {
    current: "v2026.06.20 · aaa",
    latest: "v2026.06.25 · bbb",
    behind: changelog.length || 2,
    updatable: true,
    updateAvailable: true,
    changelog,
  };
}

const sampleChangelog: ChangelogEntry[] = [
  { sha: "a", subject: "update banner", group: "new", when: "2h", date: "2026-06-25T10:00:00Z" },
  { sha: "b", subject: "fix offline fetch", group: "fixes", when: "1d", date: "2026-06-24T10:00:00Z" },
  { sha: "c", subject: "memoize reducer", group: "improvements", when: "2d", date: "2026-06-23T10:00:00Z" },
];

describe("UpdatePanel", () => {
  it("shows current → new version and the grouped changelog (New / Fixes / Improvements)", () => {
    render(<UpdatePanel info={info(sampleChangelog)} state="idle" onUpdate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("v2026.06.20 · aaa")).toBeInTheDocument();
    expect(screen.getByText("v2026.06.25 · bbb")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Fixes")).toBeInTheDocument();
    expect(screen.getByText("Improvements")).toBeInTheDocument();
    expect(screen.getByText("update banner")).toBeInTheDocument();
    expect(screen.getByText("fix offline fetch")).toBeInTheDocument();
    // relative dates surfaced
    expect(screen.getByText("2h")).toBeInTheDocument();
  });

  it("explains the update is destructive-ish (rebuild + restart + interrupted turns)", () => {
    render(<UpdatePanel info={info(sampleChangelog)} state="idle" onUpdate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveTextContent(/rebuilds.*restarts the server/i);
    expect(screen.getByRole("dialog")).toHaveTextContent(/interrupted and resume/i);
  });

  it("Update now confirms, Later dismisses", async () => {
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    render(<UpdatePanel info={info(sampleChangelog)} state="idle" onUpdate={onUpdate} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /update now/i }));
    await userEvent.click(screen.getByRole("button", { name: /later/i }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the updating state shows a live progress phase and no Update/Later buttons", () => {
    render(
      <UpdatePanel
        info={info(sampleChangelog)}
        state="updating"
        status={{ state: "building", phase: "building" }}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/building/i);
    expect(screen.getByText(/reconnects automatically/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /later/i })).not.toBeInTheDocument();
  });

  it("the failed state shows the error + a Retry button", async () => {
    const onUpdate = vi.fn();
    render(
      <UpdatePanel
        info={info(sampleChangelog)}
        state="failed"
        status={{ state: "failed", error: "pnpm -r build failed", log: "some build log" }}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/pnpm -r build failed/)).toBeInTheDocument();
    expect(screen.getByText("some build log")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the panel when not updating", async () => {
    const onClose = vi.fn();
    render(<UpdatePanel info={info(sampleChangelog)} state="idle" onUpdate={vi.fn()} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
