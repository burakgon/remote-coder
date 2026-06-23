import type { LiveWireState } from "../ui/LiveWire";

export interface MockSession { id: string; name: string; cwd: string; branch?: string; state: LiveWireState; }

export const MOCK_SESSIONS: MockSession[] = [
  { id: "7bd0a4b6-0924-46fc-b9d3-d8f33105e37b", name: "remote-coder", cwd: "~/Developer/remote-coder", branch: "main", state: "awaiting" },
  { id: "a1c2e3f4-1111-2222-3333-444455556666", name: "api-gateway", cwd: "~/work/api-gateway", branch: "feat/rate-limit", state: "streaming" },
  { id: "b2d3f4a5-7777-8888-9999-000011112222", name: "notes", cwd: "~/notes", state: "idle" },
];

export interface MockDir { name: string; path: string; isGitRepo: boolean; branch?: string; }
export const MOCK_RECENTS: MockDir[] = [
  { name: "remote-coder", path: "~/Developer/remote-coder", isGitRepo: true, branch: "main" },
  { name: "api-gateway", path: "~/work/api-gateway", isGitRepo: true, branch: "feat/rate-limit" },
];
export const MOCK_DIR_LISTING: MockDir[] = [
  { name: "packages", path: "~/Developer/remote-coder/packages", isGitRepo: false },
  { name: "docs", path: "~/Developer/remote-coder/docs", isGitRepo: false },
  { name: "infra", path: "~/Developer/infra", isGitRepo: true, branch: "prod" },
];
