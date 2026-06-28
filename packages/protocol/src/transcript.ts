export interface TranscriptTurn {
  type: "user" | "assistant";
  message: unknown;
  uuid?: string;
  parentUuid?: string | null;
  /** True for an INJECTED user-role line — context for the model, not something the human typed, so the
   * client must skip rendering it as a "YOU" bubble in replayed history (exactly as the live frame path
   * does). Two sources: claude flags skill content / tool reminders with `isMeta:true`; the harness tags
   * messages IT injected (e.g. a background `task-notification`) with an `origin.kind` (a human message
   * has none) — both are folded into this single flag here. */
  isMeta?: boolean;
  /** True for the post-compaction SEED line — the "This session is being continued…" summary claude writes
   * after a `/compact` (or an auto-compaction). It's flagged `isCompactSummary` (and `isVisibleInTranscriptOnly`)
   * but NOT `isMeta`, so without carrying it the client renders the whole summary as a giant "YOU" bubble.
   * The client surfaces a clean "Context compacted" marker instead (works for auto-compact too). */
  isCompactSummary?: boolean;
  /** The Agent/Task tool_use id this line belongs to — set for a SUBAGENT's own (sidechain) lines so the
   * reducer routes them into that subagent's thread on reopen instead of LEAKING them into the main chat.
   * Carried through from `parent_tool_use_id` (else `agentId`, else a `"sidechain"` bucket). */
  parentToolUseId?: string;
}

/**
 * Compute the `~/.claude/projects/<dir>` directory name for a cwd. LOSSY: every
 * non-alphanumeric char (including `/`, `.`, `_`, space) maps to `-`. The daemon stores the
 * REAL cwd per session and computes this from it; it must never be reversed back to a path.
 *
 * KNOWN LIMITATION (Plan 6): this mirrors Claude's simple substitution but does NOT replicate
 * Claude's truncation + base36-hash branch for very long paths (the real binary truncates the
 * encoded name past a max length and appends `-<base36-hash-of-full-cwd>`). For typical cwds the
 * result matches Claude exactly; for an unusually long cwd it can diverge, so on-disk transcript
 * history reads empty and the server falls back to the in-memory replay buffer for the current
 * session. Porting the full truncation+hash branch is future work — the exact cap/hash is not
 * pinned here on purpose (it is unverified). See docs/protocol-notes.md.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/** A user line that carries an `origin.kind` was INJECTED by the harness (e.g. a background
 *  `task-notification`), not typed by the human — a human message has no `origin`. Treated as meta so it
 *  never renders as a "YOU" bubble on reopen. */
function isInjectedOrigin(origin: unknown): boolean {
  return typeof (origin as { kind?: unknown } | null)?.kind === "string";
}

/** A minimal tree view of one transcript line, for the active-branch reconstruction below. */
export interface BranchNode {
  uuid?: string;
  parentUuid?: string | null;
  /** True for a subagent (sidechain) line — these route into their own thread, not the main chat. */
  sidechain: boolean;
}

/**
 * ACTIVE-BRANCH RECONSTRUCTION for an append-only transcript tree.
 *
 * Claude's `.jsonl` is APPEND-ONLY: a `--resume-session-at` rewind leaves the rewound-away turns
 * physically in the file. Each line has a `uuid` + `parentUuid`, so the lines form a TREE; a rewind+new
 * turn FORKS it. Reading every line in file order therefore re-shows the DEAD (rewound-away) branch on a
 * reopen — the bug this fixes.
 *
 * `nodes` are the MAIN (user/assistant) lines to return indices into; `edges` is EVERY line's uuid/
 * parentUuid in file order (incl. the intermediate tool/system/snapshot lines a main line's parentUuid
 * actually chains through — verified against real claude: an assistant's parentUuid points at such an
 * intermediate, NOT the previous main line, so the walk MUST use the full tree, not main lines alone).
 *
 * Returns the indices to KEEP (file order preserved) so only the ACTIVE branch renders — OR `null` meaning
 * "keep everything unchanged" (the caller returns its original output untouched). The algorithm:
 *   1. SAFETY/IDENTITY: no main lines, or ANY main line lacks a `uuid` (old/partial format) → null.
 *   2. Build uuid→parentUuid over ALL `edges` (the full tree). The active LEAF is the newest MAIN line
 *      (a rewind appends its new turns at the end); walk its ancestry to the root through the full tree,
 *      collecting on-path uuids (cycle-guarded, bounded by the node count).
 *   3. If EVERY main line's uuid is on that path, there is NO fork (the normal linear case) → return null
 *      (identity — the linear-transcript output is unchanged, so qa-replay parity + existing tests hold).
 *   4. Otherwise a genuine fork exists: keep the main lines on the active path, DROP the off-branch
 *      (rewound-away) ones. Also keep sidechain lines anchored to the kept path (its tool_use ids) — and,
 *      to never break subagent restore, keep a sidechain whose anchor resolves to NO main line at all
 *      (unanchorable → leave it to the downstream orphan guard rather than dropping it here).
 *
 * Pure + side-effect-free; the `toolUseIds`/`sidechainAnchor` extractors are injected so this stays free
 * of any message-shape coupling (the two callers parse slightly different intermediate shapes).
 */
export function activeBranchIndices(
  nodes: BranchNode[],
  edges: ReadonlyArray<{ uuid?: string; parentUuid?: string | null }>,
  toolUseIdsOf: (index: number) => string[],
  sidechainAnchorOf: (index: number) => string | undefined,
): number[] | null {
  const mainIdx: number[] = [];
  for (let i = 0; i < nodes.length; i++) if (!nodes[i]!.sidechain) mainIdx.push(i);
  if (mainIdx.length === 0) return null; // nothing to prune

  // IDENTITY GUARD: any main line missing a uuid → old/partial format; don't reason about the tree.
  for (const i of mainIdx) if (typeof nodes[i]!.uuid !== "string") return null;

  // FULL tree: claude chains a main line's `parentUuid` through INTERMEDIATE lines (tool/system/snapshot
  // entries), NOT directly to the previous main line — so the walk MUST traverse every line's uuid, not
  // just the main ones (walking main-only stops at the leaf and prunes nothing). Build uuid→parentUuid
  // over ALL `edges` (file order). The active LEAF is the newest MAIN line (the rewind appends its new
  // turns at the end), and we walk its ancestry to the root through the full tree.
  const fullParent = new Map<string, string | null | undefined>();
  for (const e of edges) if (typeof e.uuid === "string") fullParent.set(e.uuid, e.parentUuid);

  const onPath = new Set<string>();
  let cursor: string | null | undefined = nodes[mainIdx[mainIdx.length - 1]!]!.uuid;
  let guard = fullParent.size + 1; // bound the walk (a malformed cycle can't spin forever)
  while (typeof cursor === "string" && fullParent.has(cursor) && guard-- > 0) {
    if (onPath.has(cursor)) break; // cycle — stop
    onPath.add(cursor);
    cursor = fullParent.get(cursor);
  }

  // No fork: every main line is on the active path → identity (return null, caller keeps original).
  if (mainIdx.every((i) => onPath.has(nodes[i]!.uuid as string))) return null;

  // GENUINE-FORK GUARD (linear-identity safety). Some main line is off the active path — but that ALONE
  // doesn't prove a rewound branch. In an OLD/FLAT transcript every `parentUuid` is null, so each line is
  // its own root and the walk yields just the leaf; the off-path lines aren't a *forked* branch, they
  // simply never threaded. A true rewind FORKS: a rewound-away line's `parentUuid` points at a node ON the
  // active path (the shared fork point). Require that signal before pruning; otherwise keep everything (so
  // a parentUuid-less / pre-tree transcript stays byte-for-byte unchanged — the qa-replay parity invariant).
  const forked = mainIdx.some((i) => {
    if (onPath.has(nodes[i]!.uuid as string)) return false; // on the active path — not a fork candidate
    const p = nodes[i]!.parentUuid;
    return typeof p === "string" && onPath.has(p); // off-path line whose parent is on the active path
  });
  if (!forked) return null;

  // A genuine fork exists. Keep main lines on the path; collect their tool_use ids to anchor sidechains.
  const keptMain = new Set<number>();
  const keptToolUseIds = new Set<string>();
  for (const i of mainIdx) {
    if (!onPath.has(nodes[i]!.uuid as string)) continue;
    keptMain.add(i);
    for (const id of toolUseIdsOf(i)) keptToolUseIds.add(id);
  }
  // Every tool_use id that appears on ANY main line (to tell "off-branch anchor" from "unanchorable").
  const allMainToolUseIds = new Set<string>();
  for (const i of mainIdx) for (const id of toolUseIdsOf(i)) allMainToolUseIds.add(id);

  const keep: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i]!.sidechain) {
      if (keptMain.has(i)) keep.push(i);
      continue;
    }
    // Sidechain: keep iff anchored to a KEPT main line, OR its anchor resolves to no main line at all
    // (unanchorable — don't break subagent restore; the orphan guard downstream handles it).
    const anchor = sidechainAnchorOf(i);
    if (anchor === undefined || !allMainToolUseIds.has(anchor) || keptToolUseIds.has(anchor)) keep.push(i);
  }
  return keep;
}

/** The Agent/Task (and any) tool_use ids in a message's content — anchors for sidechain (subagent) lines. */
function toolUseIdsInMessage(message: unknown): string[] {
  const content = (message as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const block of content) {
    const b = block as { type?: string; id?: string };
    if (b?.type === "tool_use" && typeof b.id === "string") ids.push(b.id);
  }
  return ids;
}

function soleText(message: unknown): string | undefined {
  const content = (message as { content?: unknown } | null)?.content;
  if (!Array.isArray(content) || content.length !== 1) return undefined;
  const block = content[0] as { type?: string; text?: string };
  return block?.type === "text" && typeof block.text === "string" ? block.text : undefined;
}

/**
 * Parse a `<session-id>.jsonl` transcript into renderable user/assistant turns, in file order.
 * Keeps only `type ∈ {user, assistant}`; drops bookkeeping lines, malformed lines, and the
 * synthetic --resume warm-up pair ("Continue from where you left off." / "No response requested.").
 *
 * ACTIVE BRANCH ONLY: the file is append-only, so a `--resume-session-at` rewind leaves the rewound-away
 * turns physically present. We reconstruct the ACTIVE branch via the lines' `uuid`/`parentUuid` tree
 * (see `activeBranchIndices`) so a reopen after a rewind does NOT re-show the dead branch. CRITICAL: for a
 * linear transcript (no fork — the normal case) the output is BYTE-IDENTICAL to before, so the live==reopen
 * parity + existing tests are unaffected; pruning happens ONLY when a genuine fork exists.
 */
export function parseTranscript(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  // Parallel arrays (same index as `turns`) feeding the active-branch tree walk: the per-line tree node,
  // the line's own tool_use ids (anchors for sidechains), and a sidechain line's anchor tool_use id.
  const nodes: BranchNode[] = [];
  const lineToolUseIds: string[][] = [];
  const sidechainAnchors: (string | undefined)[] = [];
  // The FULL tree (every line's uuid→parentUuid, incl. the intermediate tool/system lines a main line's
  // parentUuid chains through) — needed so the active-branch walk can traverse to the real fork point.
  const edges: { uuid?: string; parentUuid?: string | null }[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue; // malformed line: skip defensively
    }
    // Record EVERY line's tree edge (before the user/assistant filter) so the walk sees intermediates.
    edges.push({
      uuid: typeof obj.uuid === "string" ? obj.uuid : undefined,
      parentUuid: typeof obj.parentUuid === "string" ? obj.parentUuid : obj.parentUuid === null ? null : undefined,
    });
    if (obj.type !== "user" && obj.type !== "assistant") continue; // drop bookkeeping
    const text = soleText(obj.message);
    if (text === "Continue from where you left off." || text === "No response requested.") continue;
    // Carry the subagent parent linkage so reopened sidechain (subagent) lines route into their thread,
    // never the main chat. Prefer the line's own parent_tool_use_id; else (a sidechain line missing it)
    // fall back to its agentId, else a constant bucket — the invariant is "never leak into main".
    const sidechain = obj.isSidechain === true;
    const parentToolUseId =
      typeof obj.parent_tool_use_id === "string"
        ? obj.parent_tool_use_id
        : sidechain
          ? typeof obj.agentId === "string"
            ? obj.agentId
            : "sidechain"
          : undefined;
    const uuid = typeof obj.uuid === "string" ? obj.uuid : undefined;
    const parentUuid = typeof obj.parentUuid === "string" ? obj.parentUuid : obj.parentUuid === null ? null : undefined;
    turns.push({
      type: obj.type,
      message: obj.message,
      uuid,
      parentUuid,
      isMeta: obj.isMeta === true || isInjectedOrigin(obj.origin) ? true : undefined,
      isCompactSummary: obj.isCompactSummary === true ? true : undefined,
      parentToolUseId,
    });
    nodes.push({ uuid, parentUuid, sidechain });
    lineToolUseIds.push(toolUseIdsInMessage(obj.message));
    sidechainAnchors.push(sidechain ? parentToolUseId : undefined);
  }

  // ACTIVE BRANCH ONLY: drop rewound-away (off-branch) lines. `null` ⇒ no fork (or old format) ⇒ keep all
  // (linear-transcript identity preserved — the safety invariant the regression suite locks in).
  const keep = activeBranchIndices(
    nodes,
    edges,
    (i) => lineToolUseIds[i]!,
    (i) => sidechainAnchors[i],
  );
  return keep === null ? turns : keep.map((i) => turns[i]!);
}
