import { describe, expect, test } from "vitest";
import { classifyPaneStatus } from "./pane-status.js";

// Every fixture below is a REAL capture-pane sample from live Claude Code sessions on the production box
// (2026-07), trimmed to the load-bearing lines. They are the ground truth the classifier was built against.

describe("classifyPaneStatus", () => {
  describe("working", () => {
    test("main spinner: gerund + live token-flow counter", () => {
      // rc-fa3f0f72 mid-turn — "…" gerund + "↓ 2.1k tokens" is the actively-generating tell.
      const pane = `
     some tool output scrolling by
✻ Schlepping… (1m 17s · ↓ 2.1k tokens)
─────────────────────────────────────────────────────
❯
─────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt`;
      expect(classifyPaneStatus(pane)).toBe("working");
    });

    test("different spinner glyph / gerund still classifies working", () => {
      expect(classifyPaneStatus("✢ Harmonizing… (1m 34s · ↓ 5.1k tokens)")).toBe("working");
      expect(classifyPaneStatus("✶ Composing… (12s · ↓ 900 tokens)")).toBe("working");
    });

    test("CRUX: main loop idle at the prompt BUT a background agent is still developing → working", () => {
      // rc-79cc7fb6 (the user's explicit correction): the MAIN loop sits at an empty prompt, but an ACTIVE
      // background agent ("⏺ general-purpose  Listing f… 24m 23s · ↓ 216.5k tokens") is still working. The
      // live gerund + "↓ 216.5k tokens" on that agent line means the SESSION is working — NOT idle/needs-you.
      const pane = `
────────────── Wave9 M2: dialog primitive + migrations ──
❯
─────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents
  ◯ main
  ⏺ general-purpose  Listing f… 24m 23s · ↓ 216.5k tokens`;
      expect(classifyPaneStatus(pane)).toBe("working");
    });

    test("blocked on a foreground agent/tool", () => {
      expect(classifyPaneStatus("✻ Waiting for 1 background agent to finish · ctrl+t to see")).toBe("working");
    });

    test("the esc-to-interrupt hint alone (spinner scrolled off) still reads working", () => {
      expect(classifyPaneStatus("  ⏵⏵ bypass permissions on · esc to interrupt")).toBe("working");
    });
  });

  describe("blocked (→ the loud 'needs you')", () => {
    test("a permission prompt: 'Do you want to proceed?'", () => {
      const pane = `
⏺ Bash(rm -rf build)
  Do you want to proceed?
❯ 1. Yes
  2. No, and tell Claude what to do differently (esc)`;
      expect(classifyPaneStatus(pane)).toBe("blocked");
    });

    test("a plan-mode approval: 'Would you like to proceed?'", () => {
      const pane = `
  Ready to code?
  Would you like to proceed?
❯ 1. Yes, and auto-accept edits
  2. Yes, and manually approve edits
  3. No, keep planning`;
      expect(classifyPaneStatus(pane)).toBe("blocked");
    });
  });

  describe("idle (calm — NOT 'needs you')", () => {
    test("a finished turn: past-tense 'Baked for …', no live token-flow", () => {
      // rc-7be03764 — done. "Baked for 23m 15s" has no gerund + no "↓ tokens", so it is NOT working.
      const pane = `
✻ Baked for 23m 15s · 2 shells still running
※ recap: the redesign is complete; next step is your approval.
─────────────────────────────────────────────────────
❯
─────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 2 shells · ← for agents`;
      expect(classifyPaneStatus(pane)).toBe("idle");
    });

    test("a FINISHED agent's summary ('Done · ↓ 12k tokens') must NOT read as working", () => {
      // The token count lingers in a past-tense summary — but there's no gerund "…", so it stays idle.
      const pane = `
  ⎿  general-purpose  Done (45s · ↓ 12k tokens)
─────────────────────────────────────────────────────
❯
  ⏵⏵ bypass permissions on`;
      expect(classifyPaneStatus(pane)).toBe("idle");
    });

    test("an empty idle prompt", () => {
      expect(classifyPaneStatus("❯\n─────\n  ⏵⏵ bypass permissions on")).toBe("idle");
    });

    test("empty pane → idle (never a false 'working' or 'blocked')", () => {
      expect(classifyPaneStatus("")).toBe("idle");
    });
  });
});
