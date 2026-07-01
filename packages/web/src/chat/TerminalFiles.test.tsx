import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalFiles, type TermFile } from "./TerminalFiles";

const imageFile: TermFile = {
  id: "f1",
  name: "shot.png",
  path: "/data/terminal-shared/s1/shot.png",
  isImage: true,
  source: "received",
};

function renderPanel() {
  return render(
    <TerminalFiles
      files={[imageFile]}
      open
      onClose={vi.fn()}
      onUpload={vi.fn()}
      downloadUrl={(p) => `/fs/download?path=${encodeURIComponent(p)}`}
    />,
  );
}

afterEach(() => {
  // Reset history state the lightbox pushes, so tests don't bleed into each other.
  vi.restoreAllMocks();
});

describe("TerminalFiles image viewer — dismissible", () => {
  it("opens a fullscreen preview with a visible Close button when a thumbnail is tapped", () => {
    renderPanel();
    // No preview initially.
    expect(screen.queryByRole("dialog", { name: "Image preview" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "shot.png" }));
    // Preview is open AND there is an obvious way out (the previous version had none).
    expect(screen.getByRole("dialog", { name: "Image preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close image" })).toBeInTheDocument();
  });

  it("closes the preview when the Close (X) button is pressed", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "shot.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Close image" }));
    expect(screen.queryByRole("dialog", { name: "Image preview" })).not.toBeInTheDocument();
  });

  it("closes the preview on Escape", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "shot.png" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Image preview" })).not.toBeInTheDocument();
  });

  it("closes the preview on a browser BACK press (popstate)", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "shot.png" }));
    expect(screen.getByRole("dialog", { name: "Image preview" })).toBeInTheDocument();
    // A real back gesture fires popstate → the viewer closes instead of the app navigating away.
    fireEvent.popState(window);
    expect(screen.queryByRole("dialog", { name: "Image preview" })).not.toBeInTheDocument();
  });
});
