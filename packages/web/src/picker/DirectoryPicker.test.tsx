import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DirectoryPicker } from "./DirectoryPicker";
import type { DirListing } from "../types/server";

const home: DirListing = {
  path: "/home/u",
  parent: "/home",
  entries: [
    { name: "remote-coder", path: "/home/u/remote-coder", isDirectory: true, isGitRepo: true, gitBranch: "main" },
    { name: "notes", path: "/home/u/notes", isDirectory: true, isGitRepo: false },
  ],
};
const repo: DirListing = { path: "/home/u/remote-coder", parent: "/home/u", entries: [] };

function listDir(path?: string): Promise<DirListing> {
  if (path === "/home/u/remote-coder") return Promise.resolve(repo);
  return Promise.resolve(home);
}

describe("DirectoryPicker", () => {
  it("lists entries, badges git repos with a branch, and filters fuzzily", async () => {
    render(<DirectoryPicker listDir={listDir} recents={[]} onPick={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("remote-coder")).toBeInTheDocument());
    expect(screen.getByText(/git:main/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/filter directories/i), "notes");
    await waitFor(() => expect(screen.queryByText("remote-coder")).not.toBeInTheDocument());
    expect(screen.getByText("notes")).toBeInTheDocument();
  });

  it("shows the current path as a breadcrumb", async () => {
    render(<DirectoryPicker listDir={listDir} recents={[]} onPick={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("remote-coder")).toBeInTheDocument());
    // The breadcrumb renders the segments of the current path.
    expect(screen.getByLabelText(/current path/i)).toHaveTextContent("home");
    expect(screen.getByLabelText(/current path/i)).toHaveTextContent("u");
  });

  it("navigates into a directory and picks the confirmed path", async () => {
    const onPick = vi.fn();
    render(<DirectoryPicker listDir={listDir} recents={[]} onPick={onPick} onCancel={vi.fn()} />);
    await waitFor(() => screen.getByText("remote-coder"));
    await userEvent.click(screen.getByText("remote-coder"));
    await waitFor(() => expect(screen.getByLabelText(/current path/i)).toHaveTextContent("remote-coder"));
    await userEvent.click(screen.getByRole("button", { name: /use this directory/i }));
    expect(onPick).toHaveBeenCalledWith("/home/u/remote-coder");
  });

  it("shows recents and picks one directly", async () => {
    const onPick = vi.fn();
    render(<DirectoryPicker listDir={listDir} recents={["/home/u/pinned-proj"]} onPick={onPick} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByText("/home/u/pinned-proj"));
    expect(onPick).toHaveBeenCalledWith("/home/u/pinned-proj");
  });

  it("surfaces an error without crashing when listing fails", async () => {
    const failing = vi.fn(() => Promise.reject(new Error("forbidden path")));
    render(<DirectoryPicker listDir={failing} recents={[]} onPick={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/forbidden path/i));
    // The sheet is still mounted and dismissible.
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("can be cancelled", async () => {
    const onCancel = vi.fn();
    render(<DirectoryPicker listDir={listDir} recents={[]} onPick={vi.fn()} onCancel={onCancel} />);
    await waitFor(() => screen.getByText("remote-coder"));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
