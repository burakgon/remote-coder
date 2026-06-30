import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

function tmuxOnPath(): boolean {
  try {
    return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function ptyLoads(): boolean {
  try {
    require.resolve("node-pty");
    return true;
  } catch {
    return false;
  }
}

/** Terminal mode needs BOTH a tmux binary and a loadable node-pty. Injectable for tests. */
export function detectTerminalSupport(
  deps: { hasTmux?: () => boolean; hasPty?: () => boolean } = {},
): boolean {
  return (deps.hasTmux ?? tmuxOnPath)() && (deps.hasPty ?? ptyLoads)();
}
