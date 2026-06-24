import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IrisCard } from "./IrisCard";

describe("IrisCard", () => {
  it("announces an iris 'awaiting you' region with the title and an assertive live region", () => {
    render(
      <IrisCard title="Awaiting you — permission" ariaLabel="Permission request">
        <div>body</div>
      </IrisCard>,
    );
    const region = screen.getByRole("region", { name: /permission request/i });
    // It is the ONE place the UI grabs attention — announced assertively so a screen-reader user
    // hears it immediately (Claude is waiting remotely).
    expect(region).toHaveAttribute("aria-live", "assertive");
    // The iris color is paired with the title TEXT (color is never the sole signal, a11y).
    expect(screen.getByText(/awaiting you/i)).toBeInTheDocument();
  });

  it("uses named keyframes for its motion so the global prefers-reduced-motion block can neutralize it", () => {
    // The entrance + halo reference rc-* keyframes defined ONCE in styles/global.css, which the
    // global @media (prefers-reduced-motion: reduce) block disables. The card itself never inlines a
    // non-gated animation. (jsdom does not evaluate the media query; we assert the named hook exists.)
    render(
      <IrisCard title="Awaiting you — question" ariaLabel="Question">
        <div>body</div>
      </IrisCard>,
    );
    const region = screen.getByRole("region", { name: /question/i });
    expect(region.style.animation).toContain("rc-rise");
  });
});
