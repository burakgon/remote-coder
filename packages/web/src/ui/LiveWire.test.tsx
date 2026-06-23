import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveWire } from "./LiveWire";

describe("LiveWire", () => {
  it("exposes an accessible status with a text label (color is not the only signal)", () => {
    render(<LiveWire state="awaiting" />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    // The awaiting state must carry readable text, not just the iris color.
    expect(status).toHaveTextContent(/awaiting/i);
  });

  it("sets a data-state attribute the CSS keys color/animation off", () => {
    const { rerender } = render(<LiveWire state="streaming" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "streaming");
    rerender(<LiveWire state="idle" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "idle");
  });

  it("honors an explicit aria-label override", () => {
    render(<LiveWire state="thinking" aria-label="Session alpha is thinking" />);
    expect(screen.getByLabelText("Session alpha is thinking")).toBeInTheDocument();
  });
});
