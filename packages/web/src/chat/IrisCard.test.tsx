import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IrisCard } from "./IrisCard";

describe("IrisCard", () => {
  it("announces an iris 'awaiting you' region whose POLITE live region is scoped to the static title", () => {
    render(
      <IrisCard title="Awaiting you — permission" ariaLabel="Permission request">
        <div>body</div>
      </IrisCard>,
    );
    const region = screen.getByRole("region", { name: /permission request/i });
    // The region itself is NOT a live region (it's the focus target) — wrapping the whole interactive
    // form in aria-live re-announced on every option toggle. The announcement is scoped to the title.
    expect(region).not.toHaveAttribute("aria-live");
    const title = screen.getByText(/awaiting you/i);
    const liveRegion = title.closest("[aria-live]");
    expect(liveRegion).not.toBeNull();
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
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
