import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectionBanner } from "./ConnectionBanner";

describe("ConnectionBanner", () => {
  it("renders nothing when online", () => {
    const { container } = render(<ConnectionBanner online={true} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("announces offline with text (not color alone)", () => {
    render(<ConnectionBanner online={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);
  });
});
