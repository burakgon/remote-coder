import { expect, test, vi } from "vitest";
import { createTerminalSocket } from "./terminal-socket";

class FakeWS {
  static last: FakeWS;
  binaryType = "";
  sent: string[] = [];
  onmessage?: (e: { data: ArrayBuffer }) => void;
  onopen?: () => void;
  onclose?: () => void;
  constructor(public url: string) { FakeWS.last = this; }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(); }
}

test("decodes binary output and encodes input/resize", () => {
  vi.stubGlobal("WebSocket", FakeWS as never);
  const got: Uint8Array[] = [];
  const sock = createTerminalSocket({ url: "wss://x/sessions/a/terminal?token=t", onData: (b) => got.push(b) });
  FakeWS.last.onopen?.();
  FakeWS.last.onmessage?.({ data: new TextEncoder().encode("hi").buffer });
  expect(new TextDecoder().decode(got[0])).toBe("hi");

  sock.sendInput("x");
  sock.sendResize(80, 24);
  expect(JSON.parse(FakeWS.last.sent[0]!)).toEqual({ t: "i", d: "x" });
  expect(JSON.parse(FakeWS.last.sent[1]!)).toEqual({ t: "r", c: 80, r: 24 });
});
