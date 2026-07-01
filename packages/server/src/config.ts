import { join } from "node:path";

export interface ServerConfig {
  claudeBin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  return { claudeBin: env.CLAUDE_BIN ?? "claude" };
}

/**
 * Wiring for the mcp-send server (Claude → user attachments). When present, the spawn layer writes a
 * per-session 0600 MCP config FILE (carrying the loopback base URL, this session's id, and the access
 * token via env) and passes its PATH to the terminal spawn as `--mcp-config <path>`. The token therefore
 * NEVER lands in any process's argv (where `ps`/`/proc` would expose it to other local users) — it
 * lives only in the mode-0600 file. ABSENT → spawn exactly as before (the feature is additive).
 */
export interface AttachSpawnOptions {
  /** Loopback base URL of remote-coder (e.g. http://127.0.0.1:4280) the tool POSTs back to. */
  baseUrl: string;
  /** The access token the mcp-send tool sends as `Authorization: Bearer <token>`. */
  token: string;
  /** Absolute path to the built dist/mcp-send.js node script. */
  mcpScriptPath: string;
  /** Host data dir (mode 0700) the per-session 0600 mcp-config-<id>.json is written into. */
  dataDir: string;
}

/** The `{ mcpServers: { ... } }` document written to the per-session 0600 config file. */
export interface McpConfigDocument {
  mcpServers: {
    "remote-coder": {
      command: string;
      args: string[];
      env: { RC_BASE_URL: string; RC_SESSION_ID: string; RC_TOKEN: string };
    };
  };
}

/**
 * Build the MCP config document for a session. PURE: no fs, no token leakage — the caller writes the
 * returned object to a 0600 file and passes its path to the terminal spawn as `--mcp-config`.
 */
export function buildMcpConfigDocument(sessionId: string, attach: AttachSpawnOptions): McpConfigDocument {
  return {
    mcpServers: {
      "remote-coder": {
        command: process.execPath,
        args: [attach.mcpScriptPath],
        env: {
          RC_BASE_URL: attach.baseUrl,
          RC_SESSION_ID: sessionId,
          RC_TOKEN: attach.token,
        },
      },
    },
  };
}

/** Absolute path of the per-session MCP config file inside the data dir. */
export function mcpConfigPathFor(dataDir: string, sessionId: string): string {
  return join(dataDir, `mcp-config-${sessionId}.json`);
}
