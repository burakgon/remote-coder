/**
 * A minimal line-level diff for rendering an Edit's old→new as a unified ±diff (the terminal shows edits
 * this way; two separate "old"/"new" code blocks made it hard to see WHAT changed). LCS-based so unchanged
 * lines render as quiet context and only the genuine insertions/deletions get +/- markers.
 *
 * Edit payloads are small (a few to a few dozen lines), so the O(n·m) DP table is fine.
 */
export interface DiffLine {
  type: "context" | "add" | "remove";
  text: string;
}

/** Compute a line diff between `oldText` and `newText` (LCS — common lines are context, the rest ±). */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;

  // dp[i][j] = length of the LCS of a[i..] and b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: "remove", text: a[i]! });
      i++;
    } else {
      out.push({ type: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ type: "remove", text: a[i++]! });
  while (j < m) out.push({ type: "add", text: b[j++]! });
  return out;
}
