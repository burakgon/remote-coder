import type { DirEntry } from "../types/server";

/** Case-insensitive subsequence match on entry.name. Empty query → all (original order). */
export function fuzzyFilter(entries: DirEntry[], query: string): DirEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => isSubsequence(q, e.name.toLowerCase()));
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}
