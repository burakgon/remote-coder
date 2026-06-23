const KEY = "remote-coder.recents";
const CAP = 8;

export function loadRecentDirs(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr.filter((x) => typeof x === "string") as string[]) : [];
  } catch {
    return [];
  }
}

export function pushRecentDir(path: string): void {
  const current = loadRecentDirs().filter((p) => p !== path);
  const next = [path, ...current].slice(0, CAP);
  localStorage.setItem(KEY, JSON.stringify(next));
}
