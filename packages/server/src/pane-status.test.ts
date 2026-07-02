import { describe, expect, test } from "vitest";
import { classifyPaneStatus } from "./pane-status.js";

// Every fixture below is a REAL capture-pane sample from live Claude Code sessions on the production box
// (2026-07), trimmed to the load-bearing lines. They are the ground truth the classifier was built against.

describe("classifyPaneStatus", () => {
  test("WORKING: an active spinner with a live parenthesised timer", () => {
    // rc-fa3f0f72 mid-turn — the parenthesised "(8m 38s" is the tell of the MAIN loop generating.
    const pane = `
     some tool output scrolling by
✳ Baking… (8m 38s · ↓ 36.0k tokens)
  ⎿  Tip: Share Claude Code and earn $10 in usage credits · /passes
─────────────────────────────────────────────────────
❯
─────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt`;
    expect(classifyPaneStatus(pane)).toBe("working");
  });

  test("WORKING: a different spinner glyph / gerund still classifies busy", () => {
    expect(classifyPaneStatus("✢ Harmonizing… (1m 34s · ↓ 5.1k tokens)")).toBe("working");
    expect(classifyPaneStatus("✶ Composing… (12s · ↓ 900 tokens)")).toBe("working");
  });

  test("WORKING: blocked on a foreground agent/tool", () => {
    expect(classifyPaneStatus("✻ Waiting for 1 background agent to finish · ctrl+t to see")).toBe("working");
  });

  test("WORKING: the esc-to-interrupt hint alone (spinner scrolled off) still reads busy", () => {
    expect(classifyPaneStatus("  ⏵⏵ bypass permissions on · esc to interrupt")).toBe("working");
  });

  test("AWAITING: a finished turn (past-tense 'Baked/Worked for', no live timer)", () => {
    // rc-7be03764 — done. "Baked for 23m 15s" has NO parenthesis, so it must NOT read as a live timer.
    const pane = `
✻ Baked for 23m 15s · 2 shells still running
※ recap: the redesign is complete; next step is your approval.
─────────────────────────────────────────────────────
❯
─────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 2 shells · ← for agents`;
    expect(classifyPaneStatus(pane)).toBe("awaiting");
  });

  test("CRUX: a BACKGROUNDED agent's bare timer must NOT read as working", () => {
    // rc-79cc7fb6 — the MAIN loop is at an empty prompt (your turn); two agents run in the background, listed
    // UNDER the status line with BARE timers ("24m 23s", no parenthesis). The parenthesis is exactly what
    // separates the main spinner from these fire-and-forget workers — so this must classify AWAITING.
    const pane = `
  2 tasks (1 done, 1 in progress, 0 open)
  ✔ Wave 9: mobile audit (2 Explore agents)
  ◼ Wave 9: execute M2 (dialog primitive)
─────────────────────────────────────────────────────
❯
─────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ctrl+t to hide tasks
  ◯ main
❯ ⏺ general-purpose  Listing files…   24m 23s · ↓ 216.5k tokens
  ◯ general-purpose  Reading…          1m 10s · ↓ 34.6k tokens`;
    expect(classifyPaneStatus(pane)).toBe("awaiting");
  });

  test("AWAITING: an empty idle prompt", () => {
    expect(classifyPaneStatus("❯\n─────\n  ⏵⏵ bypass permissions on")).toBe("awaiting");
  });

  test("AWAITING: a permission prompt (blocked on your y/n) is your turn", () => {
    const pane = `
⏺ Bash(rm -rf build)
  Do you want to proceed?
❯ 1. Yes
  2. No, tell Claude what to do differently`;
    expect(classifyPaneStatus(pane)).toBe("awaiting");
  });

  test("empty pane → awaiting (never a false 'working')", () => {
    expect(classifyPaneStatus("")).toBe("awaiting");
  });
});
