import type { InboundEvent } from "./types.js";

export class ProtocolParseError extends Error {
  constructor(
    message: string,
    readonly line: string,
  ) {
    super(message);
    this.name = "ProtocolParseError";
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

export function parseLine(line: string): InboundEvent | null {
  if (!line.trim()) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch (err) {
    throw new ProtocolParseError(`invalid JSON: ${(err as Error).message}`, line);
  }
  switch (str(obj.type)) {
    case "system":
      return {
        type: "system",
        subtype: str(obj.subtype) ?? "",
        sessionId: str(obj.session_id),
        model: str(obj.model),
        tools: Array.isArray(obj.tools) ? (obj.tools as string[]) : undefined,
        cwd: str(obj.cwd),
        raw: obj,
      };
    case "stream_event":
      return { type: "stream_event", event: obj.event, sessionId: str(obj.session_id), raw: obj };
    case "assistant":
      return { type: "assistant", message: obj.message, sessionId: str(obj.session_id), raw: obj };
    case "user":
      return { type: "user", message: obj.message, sessionId: str(obj.session_id), raw: obj };
    case "result":
      return {
        type: "result",
        subtype: str(obj.subtype),
        isError: typeof obj.is_error === "boolean" ? obj.is_error : undefined,
        result: str(obj.result),
        sessionId: str(obj.session_id),
        totalCostUsd: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : undefined,
        permissionDenials: Array.isArray(obj.permission_denials) ? obj.permission_denials : undefined,
        raw: obj,
      };
    case "control_request": {
      const request = rec(obj.request);
      return {
        type: "control_request",
        requestId: str(obj.request_id) ?? "",
        subtype: str(request.subtype) ?? "",
        request,
        raw: obj,
      };
    }
    case "control_response": {
      const response = rec(obj.response);
      return {
        type: "control_response",
        requestId: str(response.request_id),
        subtype: str(response.subtype),
        response,
        raw: obj,
      };
    }
    case "rate_limit_event":
      return { type: "rate_limit_event", raw: obj };
    default:
      return { type: "unknown", rawType: str(obj.type), raw: obj };
  }
}
