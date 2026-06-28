import type { SessionView } from "../store/frame-reducer";
import type { LiveWireState } from "../ui/LiveWire";

/**
 * OTA DRAIN WARNING (durability): the in-app update pulls + rebuilds + RESTARTS the server, which
 * interrupts any turn currently running. Before triggering POST /update we warn the user if ANY session
 * has a turn in flight, so they don't silently kill live work. This is the pure gating predicate (the
 * UI uses it to decide whether to show the confirm); kept standalone so it's trivially unit-testable.
 *
 * "In flight" = a session whose live wire is actively working — thinking / streaming / running a tool.
 * `awaiting` (a pending permission/question) is NOT counted: that turn is PAUSED on the user, not
 * actively producing, and a restart there is far less destructive (the prompt re-surfaces on reconnect).
 */
const WORKING: ReadonlySet<LiveWireState> = new Set(["thinking", "streaming", "running-tool"]);

/** True when ANY session's live view is actively working (a turn is producing output right now). */
export function anyTurnInFlight(views: Record<string, SessionView>): boolean {
  for (const view of Object.values(views)) {
    if (WORKING.has(view.wireState)) return true;
  }
  return false;
}
