import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatTelemetry, contextFillColor, formatTokens } from "./ChatTelemetry";

describe("ChatTelemetry", () => {
  it("renders the model state as a role=status with a data-state", () => {
    render(<ChatTelemetry wireState="thinking" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-state", "thinking");
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("shows the context meter (percent + token count) from contextTokens", () => {
    render(<ChatTelemetry wireState="idle" contextTokens={92000} />);
    // 92000 / 200000 = 46%.
    expect(screen.getByText("46% · 92k")).toBeInTheDocument();
    expect(screen.getByText("ctx")).toBeInTheDocument();
  });

  it("hides the context meter when there is no usage yet", () => {
    render(<ChatTelemetry wireState="idle" />);
    expect(screen.queryByText("ctx")).not.toBeInTheDocument();
  });

  it("idle reads as 'Ready' (the composer is open for input)", () => {
    render(<ChatTelemetry wireState="idle" />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("caps the meter at 100% even past the window", () => {
    render(<ChatTelemetry wireState="idle" contextTokens={250000} />);
    expect(screen.getByText(/^100% ·/)).toBeInTheDocument();
  });
});

describe("contextFillColor", () => {
  it("is coral with headroom, amber as it tightens, red when /compact is due", () => {
    expect(contextFillColor(0)).toBe("var(--coral)");
    expect(contextFillColor(80)).toBe("var(--coral)");
    expect(contextFillColor(81)).toBe("var(--warn)");
    expect(contextFillColor(92)).toBe("var(--warn)");
    expect(contextFillColor(93)).toBe("var(--err)");
    expect(contextFillColor(100)).toBe("var(--err)");
  });
});

describe("formatTokens", () => {
  it("renders compact token counts", () => {
    expect(formatTokens(900)).toBe("900");
    expect(formatTokens(5400)).toBe("5.4k");
    expect(formatTokens(90000)).toBe("90k");
    expect(formatTokens(128000)).toBe("128k");
  });
});
