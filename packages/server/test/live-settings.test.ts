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

test("applySettings accepts the allow-listed live permission modes (default/acceptEdits/plan)", async () => {
  const manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "simple" }, startTimeoutMs: 5000 },
  );
  hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });
  expect(meta.permissionMode).toBe("default");

  const accept = await hub.applySettings(meta.id, { permissionMode: "acceptEdits" });
  expect(accept.permissionMode).toBe("acceptEdits");

  const plan = await hub.applySettings(meta.id, { permissionMode: "plan" });
  expect(plan.permissionMode).toBe("plan");

  const def = await hub.applySettings(meta.id, { permissionMode: "default" });
  expect(def.permissionMode).toBe("default");
});

test("applySettings REFUSES a live bypassPermissions string (gate stays on; not reachable without dangerouslySkip)", async () => {
  const manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "simple" }, startTimeoutMs: 5000 },
  );
  hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd(), dangerouslySkip: false });
  expect(meta.permissionMode).toBe("default");
  expect(meta.dangerouslySkip).toBe(false);

  // A crafted live "bypassPermissions" frame must be ignored: the mode + the dangerouslySkip flag both
  // stay put, so the permission gate is never disabled by a bare settings string.
  const after = await hub.applySettings(meta.id, { permissionMode: "bypassPermissions" });
  expect(after.permissionMode).toBe("default");
  expect(after.dangerouslySkip).toBe(false);
  expect(hub.getSession(meta.id)?.permissionMode).toBe("default");

  // An unknown garbage mode is likewise ignored (no argv injection, gate intact).
  const garbage = await hub.applySettings(meta.id, { permissionMode: "wibble" });
  expect(garbage.permissionMode).toBe("default");
});

test("isLivePermissionMode allow-lists default/acceptEdits/plan and excludes bypassPermissions", async () => {
  const { isLivePermissionMode, LIVE_PERMISSION_MODES, PERMISSION_MODES } = await import("../src/index.js");
  expect(isLivePermissionMode("default")).toBe(true);
  expect(isLivePermissionMode("acceptEdits")).toBe(true);
  expect(isLivePermissionMode("plan")).toBe(true);
  expect(isLivePermissionMode("bypassPermissions")).toBe(false);
  expect(isLivePermissionMode("garbage")).toBe(false);
  expect(isLivePermissionMode(undefined)).toBe(false);
  // bypassPermissions IS a valid spawn-time mode (expressed via dangerouslySkip), but NOT live.
  expect(PERMISSION_MODES.has("bypassPermissions")).toBe(true);
  expect(LIVE_PERMISSION_MODES.has("bypassPermissions")).toBe(false);
});
