import type { SessionMeta } from "../types/server";
import type { LiveWireState } from "../ui/LiveWire";

export function wireStateForSession(meta: SessionMeta, view?: { wireState: LiveWireState }): LiveWireState {
  if (meta.status === "errored") return "error";
  if (meta.status === "stopped") return "idle";
  return view?.wireState ?? "idle";
}
