import { spawnSync } from "node:child_process";
import { TMUX_SOCKET } from "./terminal-process.js";

function defaultRun(): string {
  // MUST target the same dedicated `-L` socket the sessions were created on, or rehydrate sees zero live
  // sessions and prunes every stored terminal row as dead.
  const r = spawnSync("tmux", ["-L", TMUX_SOCKET, "list-sessions", "-F", "#{session_name}"], { encoding: "utf8" });
  return r.status === 0 && typeof r.stdout === "string" ? r.stdout : "";
}

/** Live tmux session names. Injectable runner for tests. Returns [] when tmux has no server / errors. */
export function listTmuxSessions(runTmuxOut: () => string = defaultRun): string[] {
  let out: string;
  try {
    out = runTmuxOut();
  } catch {
    return [];
  }
  return out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}
