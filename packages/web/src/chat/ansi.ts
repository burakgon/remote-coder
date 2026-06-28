/**
 * Strip ANSI escape sequences (color/cursor/title codes) that terminal tools emit. Rendered literally in
 * a <pre>, a sequence like ESC[31m shows as garbage (`[31m`); many CLIs (eslint, jest, ripgrep, git)
 * colorize by default, so a Bash tool result is full of them. We strip the codes for display while leaving
 * the actual text, newlines and tabs intact. The raw bytes are still preserved in the result's `raw` panel.
 *
 * The pattern (from the well-known `ansi-regex` package: CSI + OSC + common single-char escapes) is built
 * with `String.fromCharCode` so the control bytes live in a runtime string, never as control characters in
 * the source — the regex literal stays clean and no-control-regex has nothing to flag.
 */
const ESC = String.fromCharCode(0x1b); // ESC — start of a 7-bit escape sequence
const CSI8 = String.fromCharCode(0x9b); // 8-bit CSI
const BEL = String.fromCharCode(0x07); // BEL — terminates an OSC sequence
// Two alternatives, OSC first: (1) an OSC string (ESC ] … BEL) such as a window-title set — its payload
// can contain spaces, so match everything up to the terminating BEL; (2) a CSI / single-char escape
// (color, cursor, erase) — an optional intermediate, optional numeric params, then a final byte.
const ANSI_RE = new RegExp(
  `${ESC}\\][^${BEL}]*${BEL}` + `|[${ESC}${CSI8}][[\\]()#;?]*(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]`,
  "g",
);

/** True when `s` contains at least one ANSI escape sequence (so callers can skip work when there's none). */
export function hasAnsi(s: string): boolean {
  ANSI_RE.lastIndex = 0;
  return ANSI_RE.test(s);
}

/** Remove every ANSI escape sequence from `s`, leaving the visible text (and newlines/tabs) untouched. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}
