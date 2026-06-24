#!/usr/bin/env node
// Test helper: records the argv it was spawned with (to RECORD_ARGV_PATH) and completes the claude
// initialize handshake so ClaudeProcess.start() resolves. Lets a test assert the spawn argv (e.g.
// the presence + shape of --mcp-config) without a real claude binary.
import { writeFileSync } from "node:fs";

const recordPath = process.env.RECORD_ARGV_PATH;
if (recordPath) {
  // argv[0]=node, argv[1]=this script — record only the claude-style flags after it.
  writeFileSync(recordPath, JSON.stringify(process.argv.slice(2)));
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.type === "control_request" && msg.request?.subtype === "initialize") {
      process.stdout.write(
        JSON.stringify({
          type: "control_response",
          response: { subtype: "success", request_id: msg.request_id, response: {} },
        }) + "\n",
      );
    }
  }
});
process.stdin.on("end", () => process.exit(0));
