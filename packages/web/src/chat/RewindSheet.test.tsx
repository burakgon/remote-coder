import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { RewindSheet } from "./RewindSheet";

afterEach(cleanup);

describe("RewindSheet", () => {
  it("renders a focus-trapped dialog titled 'Rewind to here' with the three modes", () => {
    render(<RewindSheet checkpointId="cp-1" onConfirm={() => {}} onCancel={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: /rewind to here/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The three modes are each selectable, with one-line explanations.
    expect(screen.getByRole("radio", { name: /code/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /conversation/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /both/i })).toBeInTheDocument();
  });

  it("frames conversation/both as EDIT & RESEND (the message returns to the composer)", () => {
    // The copy must make the edit-and-resend mental model explicit: rewinding brings the message back to
    // the composer and drops the chat from here. Code stays a pure file-revert.
    render(<RewindSheet checkpointId="cp-1" onConfirm={() => {}} onCancel={() => {}} />);
    expect(
      screen.getByText(/bring this message back to the composer and drop the chat from here\. files stay\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/bring it back to the composer, drop the chat from here, and revert files to match\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/revert files changed since here\. the conversation stays\./i)).toBeInTheDocument();
  });

  it("warns that Bash-made changes are not tracked and this cannot be undone", () => {
    render(<RewindSheet checkpointId="cp-1" onConfirm={() => {}} onCancel={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/bash/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/can.?t be undone/i)).toBeInTheDocument();
  });

  it("defaults to 'code' mode and confirms with the selected mode", () => {
    const onConfirm = vi.fn();
    render(<RewindSheet checkpointId="cp-1" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("code");
  });

  it("confirms with 'conversation' once that mode is chosen", () => {
    const onConfirm = vi.fn();
    render(<RewindSheet checkpointId="cp-1" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /conversation/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith("conversation");
  });

  it("confirms with 'both' once that mode is chosen", () => {
    const onConfirm = vi.fn();
    render(<RewindSheet checkpointId="cp-1" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /both/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith("both");
  });

  it("cancels via the Cancel button and via Escape, without confirming", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(<RewindSheet checkpointId="cp-1" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(<RewindSheet checkpointId="cp-1" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
