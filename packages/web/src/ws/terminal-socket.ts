export interface TerminalSocket {
  sendInput(d: string): void;
  sendResize(cols: number, rows: number): void;
  close(): void;
}

export function createTerminalSocket(opts: {
  url: string;
  onData: (bytes: Uint8Array) => void;
  onStatus?: (s: "open" | "closed") => void;
}): TerminalSocket {
  const ws = new WebSocket(opts.url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => opts.onStatus?.("open");
  ws.onclose = () => opts.onStatus?.("closed");
  ws.onmessage = (e: MessageEvent) => {
    if (e.data instanceof ArrayBuffer || (typeof e.data === "object" && e.data !== null && "byteLength" in e.data)) {
      opts.onData(new Uint8Array(e.data));
    } else if (typeof e.data === "string") {
      opts.onData(new TextEncoder().encode(e.data));
    }
  };
  const send = (o: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(o));
  };
  return {
    sendInput: (d) => send({ t: "i", d }),
    sendResize: (cols, rows) => send({ t: "r", c: cols, r: rows }),
    close: () => ws.close(),
  };
}
