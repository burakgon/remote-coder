import { pathToFileURL } from "node:url";
import { SessionManager } from "./session-manager.js";
import { createServer } from "./transport.js";
import { loadServerConfig, assertConfigAllowsStart } from "./server-config.js";
import type { CreateServerResult } from "./transport.js";

export async function startServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CreateServerResult & { url: string }> {
  const config = loadServerConfig(env);
  assertConfigAllowsStart(config); // spec §9: refuse non-loopback bind without a token

  const manager = new SessionManager(config.claude);
  const result = createServer(config, manager);
  const url = await result.app.listen({ port: config.port, host: config.bindAddress });
  return { ...result, url };
}

// Run when executed directly (node dist/start.js), not when imported.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  startServer()
    .then(({ app, url }) => {
      console.log(`remote-coder server listening on ${url}`);
      // Graceful shutdown: app.close() fires the onClose hook, which stops every live
      // session (and its child `claude`), so a deployment leaves no orphaned processes.
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
