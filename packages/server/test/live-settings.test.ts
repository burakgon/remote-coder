import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { SessionManager, SessionHub } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

let hub: SessionHub | undefined;
afterEach(() => {
  hub?.stopAll();
  hub = undefined;
});

test("applySettings sends controls and mirrors model/effort into the session meta", async () => {
  const manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "simple" }, startTimeoutMs: 5000 },
  );
  hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd(), model: "claude-mock" });

  const updated = await hub.applySettings(meta.id, {
    model: "claude-opus-4-8",
    maxThinkingTokens: 8000,
    effort: "high",
    permissionMode: "acceptEdits",
  });
  expect(updated.model).toBe("claude-opus-4-8");
  expect(updated.effort).toBe("high");
  // getSession reflects the mutation.
  expect(hub.getSession(meta.id)?.model).toBe("claude-opus-4-8");
});

test("applySettings flips dangerouslySkip live by RESPAWNING the session (permission boundary is spawn-time)", async () => {
  const manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "simple" }, startTimeoutMs: 5000 },
  );
  hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd(), dangerouslySkip: false });
  expect(meta.dangerouslySkip).toBe(false);

  // Turning it ON respawns the session (resume) with the flag → meta flips + permissionMode bypasses.
  const on = await hub.applySettings(meta.id, { dangerouslySkip: true });
  expect(on.dangerouslySkip).toBe(true);
  expect(on.permissionMode).toBe("bypassPermissions");
  expect(on.status).toBe("running");
  expect(hub.getSession(meta.id)?.dangerouslySkip).toBe(true);

  // Turning it OFF respawns back to gated (permissionMode default).
  const off = await hub.applySettings(meta.id, { dangerouslySkip: false });
  expect(off.dangerouslySkip).toBe(false);
  expect(off.permissionMode).toBe("default");

  // Re-sending the SAME value is a no-op (no respawn needed) — still off, still running.
  const noop = await hub.applySettings(meta.id, { dangerouslySkip: false });
  expect(noop.dangerouslySkip).toBe(false);
  expect(noop.status).toBe("running");
});
