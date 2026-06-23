import type { SessionMeta } from "../types/server";
import type { LiveWireState } from "../ui/LiveWire";

export function wireStateForSession(meta: SessionMeta, view?: { wireState: LiveWireState }): LiveWireState {
  if (meta.status === "errored") return "error";
  if (meta.status === "stopped") return "idle";
  // A dormant (persisted-but-dead, post-restart) session has no live process yet — show it idle.
  if (meta.status === "dormant") return "idle";
  return view?.wireState ?? "idle";
}
