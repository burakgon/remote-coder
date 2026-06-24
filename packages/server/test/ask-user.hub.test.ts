import { afterEach, expect, test, vi } from "vitest";
import { SessionManager, SessionHub, ASK_TIMEOUT_MS } from "../src/index.js";
import type { ServerFrame, QuestionSpec } from "../src/index.js";

// These tests exercise the ask_user plumbing on the hub WITHOUT a real claude process: the session is
// created against a SessionManager whose spawn would never be hit (askUser only emits a frame + holds a
// promise), so we drive it directly. A lightweight fake "live" session is created via the public API but
// we never sendMessage, so no child interaction is required.

const QUESTIONS: QuestionSpec[] = [
  {
    question: "Which language?",
    header: "Language",
    multiSelect: false,
    options: [{ label: "TypeScript" }, { label: "Python" }],
  },
];

let hub: SessionHub | undefined;
afterEach(() => {
  vi.useRealTimers();
  hub?.stopAll();
  hub = undefined;
});

/** Build a hub with a stubbed manager so we can create a record without spawning claude. */
function makeHub(): SessionHub {
  const manager = {
    // createSession returns a session-shaped object; SessionHub.attach wires listeners on .process.
    createSession: vi.fn(async () => ({
      id: "sess-ask",
      cwd: process.cwd(),
      process: { on: vi.fn() },
    })),
    getSession: vi.fn(() => ({})),
    stopSession: vi.fn(),
  } as unknown as SessionManager;
  return new SessionHub(manager);
}

test("askUser emits a question frame carrying askId + questions and resolves on a matching answer", async () => {
  hub = makeHub();
  const meta = await hub.createSession({ cwd: process.cwd() });

  let askId: string | undefined;
  hub.subscribe(meta.id, (frame: ServerFrame) => {
    if (frame.kind === "question") {
      const p = frame.payload as { askId?: string; requestId?: string; questions?: unknown };
      askId = p.askId;
      // The frame mirrors askId into requestId so the unchanged web reducer renders it, and carries
      // the questions array for QuestionPrompt.
      expect(p.requestId).toBe(p.askId);
      expect(p.questions).toEqual(QUESTIONS);
    }
  });

  const pending = hub.askUser(meta.id, QUESTIONS);
  expect(askId).toMatch(/^ask-/);
  expect(hub.getSession(meta.id)?.awaiting).toBe(true);

  const handled = hub.answerAsk(meta.id, askId!, { "Which language?": "Python" });
  expect(handled).toBe(true);

  await expect(pending).resolves.toEqual({ answers: { "Which language?": "Python" } });
  expect(hub.getSession(meta.id)?.awaiting).toBe(false);
});

test("answerAsk returns false for an unknown/stale askId (so the legacy path can take it)", async () => {
  hub = makeHub();
  const meta = await hub.createSession({ cwd: process.cwd() });
  expect(hub.answerAsk(meta.id, "ask-nope", { q: "a" })).toBe(false);
});

test("askUser times out to { cancelled: true } and clears awaiting", async () => {
  vi.useFakeTimers();
  hub = makeHub();
  const meta = await hub.createSession({ cwd: process.cwd() });
  const pending = hub.askUser(meta.id, QUESTIONS);
  expect(hub.getSession(meta.id)?.awaiting).toBe(true);

  vi.advanceTimersByTime(ASK_TIMEOUT_MS + 1);
  await expect(pending).resolves.toEqual({ cancelled: true });
  expect(hub.getSession(meta.id)?.awaiting).toBe(false);
});

test("stopSession cancels a pending ask (no hang) and resolves it cancelled", async () => {
  hub = makeHub();
  const meta = await hub.createSession({ cwd: process.cwd() });
  const pending = hub.askUser(meta.id, QUESTIONS);
  hub.stopSession(meta.id);
  await expect(pending).resolves.toEqual({ cancelled: true });
});
