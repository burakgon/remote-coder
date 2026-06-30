// node-pty ships a prebuilt `spawn-helper` binary that MUST be executable, but pnpm's
// content-addressable store does not preserve the executable bit on extraction — so a fresh
// `pnpm install` (and every OTA self-update) leaves `spawn-helper` at 0644 and node-pty's
// `pty.fork` dies with "posix_spawnp failed." node-pty's own post-install only touches
// build/Release (the compile path), not the prebuilds/ path we load, so it can't fix this.
//
// Run from the root `postinstall`: find every node-pty `prebuilds/*/spawn-helper` under the
// install and chmod it 0755. Best-effort and idempotent — never throws, so it can't break install.
import { readdirSync, statSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Recursively collect node-pty prebuild spawn-helper paths, bounded to node_modules trees. */
function findSpawnHelpers(dir, found, depth) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "prebuilds") {
        // p/<platform>/spawn-helper
        let plats;
        try {
          plats = readdirSync(p, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const plat of plats) {
          const helper = join(p, plat.name, "spawn-helper");
          if (existsSync(helper)) found.push(helper);
        }
      } else if (e.name === "node_modules" || e.name === ".pnpm" || e.name.startsWith("node-pty") || !e.name.startsWith(".")) {
        findSpawnHelpers(p, found, depth + 1);
      }
    }
  }
}

try {
  const nm = join(ROOT, "node_modules");
  if (!existsSync(nm)) process.exit(0);
  const found = [];
  findSpawnHelpers(nm, found, 0);
  let fixed = 0;
  for (const helper of found) {
    try {
      const mode = statSync(helper).mode;
      if ((mode & 0o111) === 0) {
        chmodSync(helper, 0o755);
        fixed += 1;
      }
    } catch {
      // best-effort per file
    }
  }
  if (fixed > 0) console.log(`fix-pty-perms: made ${fixed} node-pty spawn-helper binary(ies) executable`);
} catch {
  // never break install over this
}
