export interface ServerConfig {
  claudeBin: string;
  defaultModel?: string;
  defaultEffort?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const config: ServerConfig = { claudeBin: env.CLAUDE_BIN ?? "claude" };
  if (env.CLAUDE_DEFAULT_MODEL) config.defaultModel = env.CLAUDE_DEFAULT_MODEL;
  if (env.CLAUDE_DEFAULT_EFFORT) config.defaultEffort = env.CLAUDE_DEFAULT_EFFORT;
  return config;
}

/**
 * Wiring for the mcp-send server (Claude → user attachments). When present, buildClaudeArgs adds a
 * `--mcp-config` pointing at the runnable dist/mcp-send.js with the loopback base URL, this session's
 * id, and the access token injected via env. ABSENT → spawn exactly as before (feature is additive).
 */
export interface AttachSpawnOptions {
  /** Loopback base URL of remote-coder (e.g. http://127.0.0.1:4280) the tool POSTs back to. */
  baseUrl: string;
  /** The access token the mcp-send tool sends as `Authorization: Bearer <token>`. */
  token: string;
  /** Absolute path to the built dist/mcp-send.js node script. */
  mcpScriptPath: string;
}

export interface BuildClaudeArgsOptions {
  sessionId: string;
  model?: string;
  effort?: string;
  addDirs?: string[];
  /** When true, spawn with --dangerously-skip-permissions instead of --permission-mode default. */
  dangerouslySkip?: boolean;
  /** When true, RESUME an existing session: emit --resume <sessionId> and omit --session-id. */
  resume?: boolean;
  /** When set, load the mcp-send server via --mcp-config so Claude can send files to the chat. */
  attach?: AttachSpawnOptions;
}

/**
 * Build the argv for spawning `claude` per docs/protocol-notes.md.
 * Returns flags only — no binary name, no cwd (cwd is the spawn cwd, not an arg).
 * Never includes -p/--print.
 */
export function buildClaudeArgs(opts: BuildClaudeArgsOptions): string[] {
  const args: string[] = [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--include-hook-events",
  ];

  // Resume reuses the transcript for <sessionId>; a fresh session ASSIGNS it via --session-id.
  // The binary rejects --resume together with --session-id for an existing id.
  if (opts.resume) {
    args.push("--resume", opts.sessionId);
  } else {
    args.push("--session-id", opts.sessionId);
  }

  if (opts.dangerouslySkip) {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", "default");
  }

  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.model) args.push("--model", opts.model);
  for (const dir of opts.addDirs ?? []) args.push("--add-dir", dir);

  // mcp-send wiring: the installed `claude --mcp-config` accepts an inline JSON STRING (verified via
  // `claude --help`: "Load MCP servers from JSON files or strings"), so we pass the config inline and
  // avoid managing a per-session temp file. The RC_* env carries the loopback URL, session id + token
  // to the spawned mcp-send.js so its tools can POST back to /sessions/:id/attach.
  if (opts.attach) {
    const mcpConfig = {
      mcpServers: {
        "remote-coder": {
          command: process.execPath,
          args: [opts.attach.mcpScriptPath],
          env: {
            RC_BASE_URL: opts.attach.baseUrl,
            RC_SESSION_ID: opts.sessionId,
            RC_TOKEN: opts.attach.token,
          },
        },
      },
    };
    args.push("--mcp-config", JSON.stringify(mcpConfig));
  }

  return args;
}
