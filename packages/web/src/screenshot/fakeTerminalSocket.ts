// Dev-only: a fake terminal socket for the screenshot harness. It feeds the REAL TerminalView a
// controlled test frame so a static capture can verify two things at the real mobile form factor:
//   1) GLYPHS — claude draws its logo with block-element glyphs (▛███▜) + a black (color 16) bg on the
//      inner blocks. They must render as the coral sunburst, NOT solid black boxes.
//   2) FIT — the green edge markers in column 1 and column `cols` must both be visible and flush to the
//      screen edges. If the right marker is clipped off (or there's a black gap to its right), FitAddon
//      mis-sized the grid → the "kayık"/shifted look.
import type { createTerminalSocket } from "../ws/terminal-socket";

type CreateSocket = typeof createTerminalSocket;

const ESC = "\x1b";
const RESET = `${ESC}[0m`;
const CORAL = `${ESC}[38;5;174m`; // claude's logo color (256-color 174)
const BG16 = `${ESC}[48;5;16m`; // explicit black background on the inner full-blocks
const BGRST = `${ESC}[49m`;
const GREEN = `${ESC}[1;92m`; // unmistakable edge marker

// content + its on-screen visible width → a row framed by coral borders, padded so the right border
// lands exactly in the last column. Plain-ASCII content is truncated to fit so a line never wraps.
function row(content: string, visible: number, cols: number): string {
  const innerW = Math.max(0, cols - 2);
  let c = content;
  let v = visible;
  if (v > innerW) {
    c = content.slice(0, innerW); // safe only for plain ASCII content (the labels below)
    v = innerW;
  }
  const pad = Math.max(0, innerW - v);
  return `${CORAL}│${RESET}${c}${" ".repeat(pad)}${CORAL}│${RESET}`;
}

function edgeMarker(cols: number): string {
  return `${GREEN}█${RESET}${" ".repeat(Math.max(0, cols - 2))}${GREEN}█${RESET}`;
}

export function buildPattern(cols: number, rows: number): string {
  const c = Math.max(10, cols);
  const r = Math.max(8, rows);
  const indent = "   ";
  const logo = [
    [`${indent}${CORAL}▐${BG16}▛███▜${BGRST}▌${RESET}`, indent.length + 7],
    [`${indent}${CORAL}▝▜${BG16}█████${BGRST}▛▘${RESET}`, indent.length + 8],
    [`${indent}${CORAL}▘▘ ▝▝${RESET}`, indent.length + 5],
  ] as const;

  // Emit EXACTLY `r` physical lines (top border + r-2 body + bottom border) so nothing wraps/scrolls.
  const body: string[] = [];
  const label = ` cols=${cols} rows=${rows} edges flush?`;
  body.push(row(label, label.length, c));
  body.push(edgeMarker(c));
  body.push(row("", 0, c));
  body.push(row(" Logo: coral, not black?", 24, c));
  for (const [content, visible] of logo) body.push(row(content, visible, c));
  body.push(row("", 0, c));
  body.push(edgeMarker(c));
  while (body.length < r - 2) body.push(row("", 0, c));
  const lines = [
    `${CORAL}╭${"─".repeat(c - 2)}╮${RESET}`,
    ...body.slice(0, r - 2),
    `${CORAL}╰${"─".repeat(c - 2)}╯${RESET}`,
  ];
  return lines.join("\r\n");
}

/** A CreateSocket that ignores the URL and redraws the test pattern at whatever size the component fits
 *  to (so the capture reflects the REAL fitted grid). */
export function makeFakeTerminalSocket(): CreateSocket {
  return ({ onData, onStatus }) => {
    const enc = new TextEncoder();
    const draw = (cols: number, rows: number) => {
      (window as unknown as { __termFit?: { cols: number; rows: number } }).__termFit = { cols, rows };
      onData(enc.encode(`${ESC}[2J${ESC}[3J${ESC}[H${buildPattern(cols, rows)}`));
    };
    // open → the component refits and calls sendResize with the real fitted size.
    setTimeout(() => onStatus?.("open"), 0);
    return {
      sendInput() {},
      sendResize(cols: number, rows: number) {
        draw(cols, rows);
      },
      close() {},
    };
  };
}
