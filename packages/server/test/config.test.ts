import { expect, test } from "vitest";
import { loadConfig, buildMcpConfigDocument, mcpConfigPathFor } from "../src/index.js";

test("loadConfig defaults claudeBin to 'claude'", () => {
  expect(loadConfig({})).toEqual({ claudeBin: "claude" });
});

test("loadConfig reads CLAUDE_BIN", () => {
  expect(loadConfig({ CLAUDE_BIN: "/opt/claude" })).toEqual({ claudeBin: "/opt/claude" });
});

test("loadConfig never surfaces ANTHROPIC_API_KEY", () => {
  const cfg = loadConfig({ ANTHROPIC_API_KEY: "sk-should-be-ignored" });
  expect(JSON.stringify(cfg)).not.toContain("sk-should-be-ignored");
});

test("buildMcpConfigDocument carries the loopback URL, session id, token and the runnable mcp-send.js script", () => {
  const doc = buildMcpConfigDocument("sid-9", {
    baseUrl: "http://127.0.0.1:4280",
    token: "tok-9",
    mcpScriptPath: "/abs/dist/mcp-send.js",
    dataDir: "/data",
  });
  expect(doc.mcpServers["remote-coder"]).toEqual({
    command: process.execPath,
    args: ["/abs/dist/mcp-send.js"],
    env: {
      RC_BASE_URL: "http://127.0.0.1:4280",
      RC_SESSION_ID: "sid-9",
      RC_TOKEN: "tok-9",
    },
  });
});

test("mcpConfigPathFor builds a per-session path inside the data dir", () => {
  expect(mcpConfigPathFor("/data", "sid-9")).toBe("/data/mcp-config-sid-9.json");
});
