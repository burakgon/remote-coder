import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Library entry — imported by other packages; no shebang.
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    tsconfig: "tsconfig.build.json",
  },
  {
    // Executable entry for the `remote-coder-server` bin.
    entry: ["src/start.ts"],
    format: ["esm"],
    dts: true,
    clean: false, // don't wipe the index.* output from the first config
    tsconfig: "tsconfig.build.json",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    // Runnable stdio MCP server: spawned as claude's MCP subprocess (via --mcp-config) so claude can
    // send files/images to the chat. Emits dist/mcp-send.js as a standalone node script.
    entry: ["src/mcp-send.ts"],
    format: ["esm"],
    dts: false, // not imported as a library; the test imports the source directly
    clean: false,
    tsconfig: "tsconfig.build.json",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
