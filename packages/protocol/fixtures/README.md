# Protocol fixtures

Real, captured transcripts of the `claude` CLI driven over its bidirectional
`stream-json` protocol. These are the ground-truth inputs for the `protocol`
parser/serializers and the mock `claude` (Tasks 3–5). The full schema, with an
annotated example of every line type, is in
[`docs/protocol-notes.md`](../../../docs/protocol-notes.md).

Captured from **`claude` v2.1.186** on macOS (arm64), subscription auth
(`ANTHROPIC_API_KEY` unset). Regenerate with `scripts/spike/drive.mjs` (see
below).

## Files

| File | What it captures |
|------|------------------|
| `permission-turn.jsonl` | A turn that uses the **Write** tool, so it exercises the **permission/control** path: our `initialize` handshake, the CLI's `control_response`, the CLI's `hook_callback` `control_request` (the permission ask, via a registered PreToolUse hook), our allow `control_response`, the tool execution, the `tool_result`, and the final `result` (`permission_denials: []` — the tool was allowed and ran). |
| `simple-turn.jsonl` | A trivial text turn ("what is 2+2?"). No tool, **no permission request** — just `initialize` + handshake reply, `system/init`, streaming `stream_event` deltas, the assistant text, and `result`. Baseline for the no-permission path. |

## Line format

Each line is one JSON object (newline-delimited). Lines are a mix of:

- **CLI → client** output, recorded **verbatim** (no extra fields).
- **client → CLI** messages we sent, tagged with a fixture-only
  **`"_dir":"out"`** field so direction is recoverable. **`_dir` is not part of
  the wire protocol** — the real bytes the CLI receives do not contain it; strip
  it before feeding a line back to the protocol layer.

## Sanitization

Only free-text **values** were neutralized; **no structural keys were altered**
and every line is still valid JSON:

- home path `…/Users/<name>` → `/Users/user`
- account email → `user@example.com`
- organization display name → `Example Org`

The throwaway working directory (`/private/tmp/rc-spike`) is left as-is — it is
not host-identifying and the `cwd`/`file_path` values are structurally useful.

## Regenerate

Run from a **throwaway** directory (never the repo), with subscription auth:

```bash
mkdir -p /tmp/rc-spike && cd /tmp/rc-spike

# permission turn (forces a Write → a hook_callback control_request)
node /ABSOLUTE/PATH/remote-coder/scripts/spike/drive.mjs \
  /ABSOLUTE/PATH/remote-coder/packages/protocol/fixtures/permission-turn.jsonl \
  "Use the Write tool to create a file named spike.txt with the text hello" \
  allow

# simple turn (no tool, no permission)
node /ABSOLUTE/PATH/remote-coder/scripts/spike/drive.mjs \
  /ABSOLUTE/PATH/remote-coder/packages/protocol/fixtures/simple-turn.jsonl \
  "In one short sentence, what is 2+2?" \
  allow
```

Then re-apply sanitization (home path / email / org) before committing. Output
varies run-to-run (session ids, token counts, exact wording); the **shapes** are
stable.
