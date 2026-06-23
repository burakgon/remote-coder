import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { SessionManager } from "./session-manager.js";
import { createServer } from "./transport.js";
import { loadServerConfig, assertConfigAllowsStart, isLoopbackAddress } from "./server-config.js";
import { ensureDataDir, resolveAccessToken } from "./data-dir.js";
import { openSessionStore } from "./session-store.js";
import { openIdempotencyStore } from "./idempotency.js";
import { HistoryService } from "./history-service.js";
import type { CreateServerResult } from "./transport.js";

export async function startServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CreateServerResult & { url: string; token?: string; tokenGenerated: boolean }> {
  const config = loadServerConfig(env);

  // First-run token (spec §9): use ACCESS_TOKEN if set, else the persisted token, else generate.
  // EXPLICIT OPT-OUT: NO_TOKEN=1 keeps the Plan-3 tokenless dev path (no token generated/stored/
  // required) and only RUNS on a loopback bind (assertConfigAllowsStart enforces that below).
  // SECURITY: a token is auto-generated only when the bind is loopback OR a token is already
  // configured/persisted. A FIRST non-loopback bind with no token is left tokenless so
  // assertConfigAllowsStart refuses to start — we never silently mint a secret for a public bind.
  ensureDataDir(config.dataDir);
  const loopback = isLoopbackAddress(config.bindAddress);
  let token: string | undefined;
  let generated = false;
  const tokenless = env.NO_TOKEN === "1";
  const mayResolveToken = !tokenless && (loopback || config.accessToken !== undefined);
  if (mayResolveToken) {
    const resolved = resolveAccessToken({ configured: config.accessToken, dataDir: config.dataDir });
    token = resolved.token;
    generated = resolved.generated;
    config.accessToken = token;
  }

  assertConfigAllowsStart(config); // refuses a non-loopback bind that still has no token

  const store = openSessionStore({ dbPath: join(config.dataDir, "sessions.db") });
  const idempotency = openIdempotencyStore({ dbPath: join(config.dataDir, "idempotency.db") });
  const history = new HistoryService();

  const manager = new SessionManager(config.claude);
  const result = createServer(config, manager, { store, history, idempotency });
  const url = await result.app.listen({ port: config.port, host: config.bindAddress });
  return { ...result, url, token, tokenGenerated: generated };
}

// Run when executed directly (node dist/start.js), not when imported.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  startServer()
    .then(({ app, url, token, tokenGenerated }) => {
      console.log(`remote-coder server listening on ${url}`);
      if (tokenGenerated && token) {
        console.log(`\n  Access token (generated, stored in the data dir):\n    ${token}\n  Open: ${url}/?token=${token}\n`);
      } else if (!token) {
        console.log(`  (NO_TOKEN tokenless loopback dev mode — no access token required)`);
      }
      // Graceful shutdown: app.close() fires the onClose hook, which stops every live session
      // (and its child `claude`), so a deployment leaves no orphaned processes.
      const shutdown = (signal: NodeJS.Signals) => {
        console.log(`received ${signal}, shutting down`);
        app
          .close()
          .then(() => process.exit(0))
          .catch(() => process.exit(0));
      };
      process.on("SIGTERM", () => shutdown("SIGTERM"));
      process.on("SIGINT", () => shutdown("SIGINT"));
    })
    .catch((err: unknown) => {
      console.error(`remote-coder server failed to start: ${(err as Error).message}`);
      process.exit(1);
    });
}
