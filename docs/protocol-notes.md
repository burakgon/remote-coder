# Claude Code stream-json + control protocol — observed schema

Captured by driving the **real** `claude` binary (v2.1.186, subscription auth,
`ANTHROPIC_API_KEY` unset) via `scripts/spike/drive.mjs`. Every shape below has a
real, captured example line, sanitized only in free-text fields (home path →
`/Users/user`, email → `user@example.com`, org → `Example Org`). Structural keys
are untouched. Source fixtures: `packages/protocol/fixtures/{permission-turn,simple-turn}.jsonl`.

> This is the canonical reference for Tasks 3–5 (parser, serializers, mock
> `claude`). When a shape here disagrees with a guess elsewhere, **this wins** —
> it is what the binary actually emitted/accepted.

## How `claude` is invoked

```
claude \
  --input-format  stream-json \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --include-hook-events \
  --permission-mode default
```

- **No `-p`/`--print`.** Bidirectional stream-json (stdin+stdout both
  `stream-json`) keeps the session interactive enough to round-trip
  `control_request`s; the process still exits after the `result` once we close
  stdin.
- **`--verbose`** is required for `stream-json` output.
- **`--include-partial-messages`** turns on the `stream_event` (SSE-style)
  delta lines.
- **`--include-hook-events`** surfaces `hook_started` / `hook_response` system
  lines (and is what makes the PreToolUse hook callback fire as a
  `control_request` — see "Permissions" below).
- Subscription auth: the spike deletes any inherited `ANTHROPIC_API_KEY` before
  spawning. `system/init` confirms with `"apiKeySource":"none"`.

Every line on stdout is one JSON object (newline-delimited). The CLI never emits
multi-line JSON.

---

## Message taxonomy

Top-level discriminator is `type`. Observed values on stdout:

| `type`             | Direction | Meaning |
|--------------------|-----------|---------|
| `system`           | CLI→client | Lifecycle/metadata. Discriminated further by `subtype`. |
| `stream_event`     | CLI→client | SSE-style incremental deltas; the real event is nested under `event`. |
| `assistant`        | CLI→client | A complete assistant message (one content block per line). |
| `user`             | CLI→client | A complete user message — here, the synthetic `tool_result` after a tool runs. |
| `result`           | CLI→client | Terminal line for the turn: cost, usage, final text, denials. |
| `control_request`  | **both** | Out-of-band request needing a `control_response`. See "Control protocol". |
| `control_response` | **both** | Reply to a `control_request`. |
| `rate_limit_event` | CLI→client | Rate-limit status snapshot (`rate_limit_info`). |

Sent by the client (us) on stdin: `control_request` (the `initialize`
handshake), `control_response` (answers), and `user` (the prompt). In the
committed fixtures, lines **we sent** are tagged `"_dir":"out"` (a fixture-only
annotation; the real wire bytes do not contain `_dir`). Untagged lines are
verbatim CLI output.

---

## 1. `system` / `init`

First line of every session. Carries session identity and capabilities.

```json
{"type":"system","subtype":"init","cwd":"/private/tmp/rc-spike","session_id":"0ea4a7b2-9680-4b86-91a6-a1cca086895c","tools":["Task","AskUserQuestion","Bash", …],"mcp_servers":[{"name":"context7","status":"pending"}, …],"model":"claude-opus-4-8[1m]","permissionMode":"default","slash_commands":[ … ],"apiKeySource":"none","claude_code_version":"2.1.186","output_style":"default","agents":[ … ],"skills":[ … ],"plugins":[ … ],"uuid":"9b392d07-78c0-43d6-a4ed-3ce224c1ef97","memory_paths":{"auto":"/Users/user/.claude/projects/-private-tmp-rc-spike/memory/"}, …}
```

Field map (the ones Tasks 3–5 care about):
- **`session_id`** — UUID string. The same value reappears on every subsequent
  line as a top-level `session_id`.
- **`model`** — e.g. `"claude-opus-4-8[1m]"` (note the `[1m]` context-window
  suffix; the `assistant` message blocks report the bare `"claude-opus-4-8"`).
- **`tools`** — array of tool-name strings (31 in this capture).
- **`cwd`** — absolute working directory.
- Also present: `permissionMode`, `apiKeySource` (`"none"` under subscription),
  `claude_code_version`, `mcp_servers` (`{name,status}`), `slash_commands`,
  `agents`, `skills`, `plugins`, `output_style`, `uuid`, `memory_paths`.

Other `system` subtypes observed (only with `--include-hook-events` /
`--verbose`):

```json
{"type":"system","subtype":"status","status":"requesting","session_id":"…"}
{"type":"system","subtype":"thinking_tokens","estimated_tokens":50,"estimated_tokens_delta":50,"session_id":"…"}
{"type":"system","subtype":"hook_started","hook_id":"…","hook_name":"SessionStart:startup","hook_event":"SessionStart","session_id":"…"}
{"type":"system","subtype":"hook_response","hook_id":"…","hook_name":"SessionStart:startup","hook_event":"SessionStart","output":"Session status updated.\n","stdout":"…","stderr":"","exit_code":0, …}
```

A parser should treat `system` as open-ended: switch on `subtype`, tolerate
unknown subtypes.

---

## 2. `stream_event` (partial messages)

The Anthropic Messages SSE stream, wrapped. The real event is under
`event`; the wrapper adds `session_id`, `parent_tool_use_id`, `uuid`.

```json
{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-opus-4-8","id":"msg_01LfQM2qKfEhuQAXvv4CcU9A","type":"message","role":"assistant","content":[],"stop_reason":null, …}},"session_id":"…","parent_tool_use_id":null,"uuid":"…"}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"2"}},"session_id":"…","parent_tool_use_id":null,"uuid":"…"}
```

Observed nested `event.type` values, and for `content_block_delta` the
`delta.type` values:

| `event.type`          | `delta.type` (when applicable) |
|-----------------------|--------------------------------|
| `message_start`       | — (carries the seed `message` envelope) |
| `content_block_start` | — (carries the new `content_block`) |
| `content_block_delta` | `text_delta` (`delta.text`) |
| `content_block_delta` | `input_json_delta` (`delta.partial_json` — streamed tool input) |
| `content_block_delta` | `thinking_delta` (`delta.thinking`) |
| `content_block_delta` | `signature_delta` (`delta.signature` — thinking-block signature) |
| `content_block_stop`  | — |
| `message_delta`       | — (`event.delta` carries `stop_reason`; `event.usage`) |
| `message_stop`        | — |

These are exactly the standard Messages streaming events; a parser can reuse
Anthropic SSE types for `event` and just unwrap the `stream_event` envelope.

---

## 3. `assistant` / `user` (complete messages)

`assistant` lines carry a full `message` (Anthropic shape). Each line has a
single content block. Example with a `tool_use` block:

```json
{"type":"assistant","message":{"id":"msg_01GmeWu9Qj6q7TYFgfM5Rygx","role":"assistant","model":"claude-opus-4-8","stop_reason":null,"content":[{"type":"tool_use","id":"toolu_01DC8WPnnR3GjMKYZBhcruUq","name":"Write","input":{"file_path":"/private/tmp/rc-spike/spike.txt","content":"hello\n"}}], …},"session_id":"…","parent_tool_use_id":null, …}
```

(`assistant` also appears with `content:[{"type":"thinking", …}]` and
`content:[{"type":"text", …}]`.)

`user` lines from the CLI carry the synthetic tool result after a tool runs:

```json
{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01DC8WPnnR3GjMKYZBhcruUq","type":"tool_result","content":"File created successfully at: /private/tmp/rc-spike/spike.txt …"}]},"parent_tool_use_id":null,"session_id":"…", …}
```

The `tool_result`'s `tool_use_id` matches the `tool_use.id` from the assistant
message. `parent_tool_use_id` is `null` for top-level turns (non-null inside
sub-agent/Task tool runs).

---

## 4. `result`

Terminal line of a turn.

```json
{"type":"result","subtype":"success","is_error":false,"num_turns":2,"session_id":"7bd0a4b6-0924-46fc-b9d3-d8f33105e37b","result":"Created `spike.txt` with the text `hello`.","stop_reason":"end_turn","total_cost_usd":0.165912,"usage":{"input_tokens":9264,"cache_creation_input_tokens":…,"cache_read_input_tokens":…,"output_tokens":244,"server_tool_use":{…},"service_tier":"standard","cache_creation":{…},"inference_geo":"not_available","iterations":[…],"speed":"standard"},"permission_denials":[],"terminal_reason":"completed","uuid":"…"}
```

Field map:
- **`subtype`** — `"success"` (also `"error_*"` variants exist; not captured).
- **`is_error`** — boolean.
- **`result`** — the final assistant text (string).
- **`session_id`**, **`stop_reason`** (`"end_turn"`), **`num_turns`**.
- **`total_cost_usd`**, **`usage`** (`input_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`,
  `server_tool_use`, `service_tier`, `cache_creation`, `inference_geo`,
  `iterations`, `speed`), **`modelUsage`** (per-model breakdown).
- **`permission_denials`** — array of
  `{tool_name, tool_use_id, tool_input}` for tools that were denied. **`[]`
  when the tool was allowed** (the success/allow case in our permission turn).
- **`terminal_reason`** — `"completed"`.

---

## Control protocol (the under-documented part)

### Envelope

A control message is `{"type":"control_request", "request_id", "request":{…}}`
or `{"type":"control_response", "response":{…}}`. **`request_id` lives at the
top level of a `control_request`** and is echoed back **inside `response`** of
the `control_response`. The discriminator inside `request`/`response` is
`subtype`.

Confirmed shapes (parser-side) from the binary's own handler:
`processControlRequest(e)` dispatches on `e.request.subtype` ∈
`{ can_use_tool, hook_callback, mcp_message, elicitation, request_user_dialog,
oauth_token_refresh, host_auth_token_refresh }`, and `request(e)` builds
`{request_id, type:"control_request", request:e}`. Client→CLI control subtypes
the binary accepts include `initialize`, `interrupt`, `set_permission_mode`,
`set_model`, `set_max_thinking_tokens`, `get_settings`, etc.

### 5a. `initialize` handshake (client → CLI), and the CLI's response

The client opens the session by sending an `initialize` `control_request`. The
CLI replies with a `control_response` carrying the full session capability
manifest. **This is also how the client registers hooks** (see permissions).

What we send:

```json
{"type":"control_request","request_id":"init-4bbaea34-…","request":{"subtype":"initialize","hooks":{"PreToolUse":[{"matcher":"","hookCallbackIds":["hook_0"]}]}}}
```

What the CLI sends back (truncated — the `response` is large):

```json
{"type":"control_response","response":{"subtype":"success","request_id":"init-4bbaea34-…","response":{"commands":[…65 entries…],"agents":[…9…],"output_style":"default","available_output_styles":["default","Proactive","Explanatory","Learning"],"models":[…4…],"account":{"email":"user@example.com","organization":"Example Org","subscriptionType":"Claude Max","apiProvider":"firstParty"},"pid":33739,"feedback_survey_config":{…}}}}
```

So the `control_response` envelope is **`{type:"control_response", response:{
subtype:"success", request_id, response:<payload> }}`** — `request_id` and
`subtype` are siblings *inside* `response`, and the actual payload is nested one
level deeper as `response.response`. (An error reply is
`response:{subtype:"error", request_id, error:"…"}`.)

The SDK init request may also include `sdkMcpServers`, `jsonSchema`,
`systemPrompt`, `appendSystemPrompt`, `agents`, `skills`, etc.; only `subtype`
and `hooks` are required for our purposes.

### 5b. The permission request — `hook_callback` (CLI → client)

**KEY FINDING.** In headless stream-json mode, an un-gated tool in
`--permission-mode default` is **auto-denied** — the CLI does **not** emit a
`can_use_tool` `control_request` to stdout. (The binary literally logs *"entered
'requires\_action' (likely a permission prompt) with no client to answer it"* and
short-circuits to deny.) The direct `can_use_tool` control_request path is
reserved for the CLI's interactive **bridge/Remote-Control** session, not
headless stdio.

The mechanism that **does** surface an answerable permission request over
headless stdio is a **PreToolUse hook** registered in the `initialize`
handshake. When the model calls a tool, the CLI sends a `hook_callback`
`control_request`; the client answers with a `control_response` whose payload
carries a `PreToolUse` permission decision, and the tool then executes (or is
blocked) accordingly.

The `hook_callback` `control_request` the CLI sent us (verbatim, sanitized):

```json
{"type":"control_request","request_id":"fc9a4b4b-b542-452e-9d1a-54710ae0c3de","request":{"subtype":"hook_callback","callback_id":"hook_0","input":{"session_id":"7bd0a4b6-…","transcript_path":"/Users/user/.claude/projects/-private-tmp-rc-spike/7bd0a4b6-….jsonl","cwd":"/private/tmp/rc-spike","permission_mode":"default","effort":{"level":"xhigh"},"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/private/tmp/rc-spike/spike.txt","content":"hello\n"},"tool_use_id":"toolu_01DC8WPnnR3GjMKYZBhcruUq"}}}
```

- **`request_id`** — top-level; echo it back in the response.
- **`request.subtype`** — `"hook_callback"`.
- **`request.callback_id`** — `"hook_0"` (matches the id we registered in
  `initialize.hooks.PreToolUse[].hookCallbackIds`).
- **`request.tool_use_id`** — also mirrored at `request.input.tool_use_id`.
- **`request.input`** — the PreToolUse hook payload: `session_id`,
  `transcript_path`, `cwd`, `permission_mode`, `effort`, `hook_event_name`
  (`"PreToolUse"`), **`tool_name`** (`"Write"`), **`tool_input`** (the proposed
  tool call), `tool_use_id`.

### 5c. The `control_response` that the binary ACCEPTED (allow)

What we sent to allow the Write — and the file was then created
(`result.permission_denials == []`):

```json
{"type":"control_response","response":{"subtype":"success","request_id":"fc9a4b4b-b542-452e-9d1a-54710ae0c3de","response":{"async":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"spike auto-allow"}}}}
```

- Envelope: `{type:"control_response", response:{subtype:"success",
  request_id, response:<payload>}}` (same shape as the init reply).
- Payload (`response.response`):
  - **`async`** — `false`.
  - **`hookSpecificOutput`** — `{hookEventName:"PreToolUse",
    permissionDecision:"allow"|"deny", permissionDecisionReason:<string>}`.
- **Deny** is the same shape with `permissionDecision:"deny"`; the tool is then
  blocked and shows up in `result.permission_denials`. A plain
  `response:{async:false}` (no `hookSpecificOutput`) does **not** grant
  permission → falls through to the default auto-deny.

### 5d. `can_use_tool` (direct permission path — for reference)

Not emitted over headless stdio in this version, but the binary builds it as
(extracted from the binary, verbatim):

```js
{subtype:"can_use_tool", tool_name, display_name, input, tool_use_id, description, ...(permission_suggestions && {permission_suggestions})}
```

i.e. `{"type":"control_request","request_id":…,"request":{"subtype":"can_use_tool",
"tool_name","display_name","input","tool_use_id","description","permission_suggestions"?}}`.
The matching answer (from the binary's parser + the SDK's `PermissionResult`
type) is a `control_response` whose `response.response` is the permission
result: **allow** = `{behavior:"allow", updatedInput:<input>, userModified?:bool,
contentBlocks?:[…]}`, **deny/ask** = `{behavior:"deny"|"ask", message:<string>,
contentBlocks?:[…]}`. The driver answers this shape too, defensively, in case a
future/interactive transport uses it. Tasks 3–5 should support **both** the
`hook_callback` and `can_use_tool` permission shapes.

### 6. The outbound user-message envelope that the binary ACCEPTED

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Use the Write tool to create a file named spike.txt with the text hello"}]}}
```

- The minimal accepted shape is **`{type:"user", message:{role:"user",
  content:[…]}}`**. `content` may be a string or a content-block array; the
  block array (`[{type:"text",text:…}]`) is what we used and it worked.
- Optional fields the CLI also accepts / echoes: `parent_tool_use_id`,
  `session_id` (omit to start a new session). The first-guess SDK envelope was
  correct as-is — no alternate was needed.
- To send a **tool result** back as a user turn, the same envelope with a
  `tool_result` content block applies (see §3).

---

## Summary for Tasks 3–5

- **Parsing inbound stdout**: discriminate on `type`; for `system` switch on
  `subtype` (open set); for `stream_event` unwrap `event` and reuse Anthropic
  SSE types; `assistant`/`user` carry standard Messages `message` objects.
- **`control_request` / `control_response` envelopes**: `request_id` is
  top-level on requests, nested under `response` on responses; payloads are at
  `request.<fields>` / `response.response`.
- **Permissions**: the practical, headless mechanism is **PreToolUse hook →
  `hook_callback` control_request → `control_response` with
  `hookSpecificOutput.permissionDecision`**. Also model the `can_use_tool`
  shape for the interactive transport.
- **Serializing outbound**: `initialize` handshake first (register hooks),
  then `{type:"user", message:{role,content}}`, then `control_response`s to
  answer `hook_callback`/`can_use_tool`.
- **Lifecycle**: send `initialize` → on its `control_response`, send the user
  message → answer any `hook_callback` → on `result`, close stdin → child
  exits.
