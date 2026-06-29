import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

/**
 * In-app re-authentication of the `claude` CLI's Claude subscription, so a user whose server-side login
 * expired (Anthropic returns 401 "Invalid authentication credentials" → every turn fails) can sign in
 * again FROM THE APP instead of SSHing to the server to run `claude auth login`.
 *
 * It wraps `claude`'s OWN manual OAuth flow (no reverse-engineering of Anthropic's OAuth):
 *   1. `claude auth login --claudeai` prints an authorize URL whose redirect is a HOSTED page
 *      (platform.claude.com/oauth/code/callback — not localhost), then waits on stdin for a pasted code.
 *   2. We spawn it, capture that URL, and hand it to the UI; the user opens it in ANY browser (their
 *      phone), authorizes, and copies the code the callback page shows.
 *   3. The UI posts the code back; we write it to the subprocess stdin; `claude` exchanges it and saves
 *      FRESH credentials where every future claude spawn reads them — auth is restored, no restart needed.
 *
 * Single in-flight login at a time (a new start supersedes a stale one); a started login self-expires so
 * an abandoned flow can't hold a subprocess forever. Spawn deps are injectable for unit tests.
 */

export interface ClaudeAuthStatus {
  /** Whether `claude` has stored credentials. NOTE: this reflects the LOCAL creds existing, not that they
   *  still work — expired creds report loggedIn:true yet 401 on use, so re-auth is offered regardless. */
  loggedIn: boolean;
  email?: string;
  /** "max" | "pro" | … (the Claude subscription tier), when reported. */
  subscriptionType?: string;
  authMethod?: string;
  orgName?: string;
}

/** Parse `claude auth status` JSON output into a status. Returns {loggedIn:false} on any unparhseable/empty. */
export function parseAuthStatus(stdout: string): ClaudeAuthStatus {
  try {
    const o = JSON.parse(stdout) as Record<string, unknown>;
    return {
      loggedIn: o.loggedIn === true,
      email: typeof o.email === "string" ? o.email : undefined,
      subscriptionType: typeof o.subscriptionType === "string" ? o.subscriptionType : undefined,
      authMethod: typeof o.authMethod === "string" ? o.authMethod : undefined,
      orgName: typeof o.orgName === "string" ? o.orgName : undefined,
    };
  } catch {
    return { loggedIn: false };
  }
}

/** Pull the authorize URL out of `claude auth login` output ("…visit: https://…/oauth/authorize?…"). */
export function extractLoginUrl(output: string): string | undefined {
  const m = /(https:\/\/[^\s]+oauth\/authorize[^\s]*)/i.exec(output);
  return m ? m[1] : undefined;
}

export interface ClaudeAuthDeps {
  /** Spawn a claude subcommand: `claude <args>` with the server env (login-session creds resolve). */
  spawn: (args: string[]) => ChildProcess;
  now: () => number;
  /** How long a started login waits for the URL before giving up (default 20s). */
  urlTimeoutMs?: number;
  /** How long a started login may sit awaiting its code before self-expiring (default 5min). */
  loginTtlMs?: number;
}

export const LOGIN_URL_TIMEOUT_MS = 20_000;
export const LOGIN_TTL_MS = 5 * 60_000;
const STATUS_TIMEOUT_MS = 15_000;

interface PendingLogin {
  id: string;
  child: ChildProcess;
  output: string;
  startedAt: number;
  expiry: ReturnType<typeof setTimeout>;
}

export class ClaudeAuthService {
  private readonly deps: Required<Pick<ClaudeAuthDeps, "spawn" | "now">> & {
    urlTimeoutMs: number;
    loginTtlMs: number;
  };
  private pending?: PendingLogin;

  constructor(deps: ClaudeAuthDeps) {
    this.deps = {
      spawn: deps.spawn,
      now: deps.now,
      urlTimeoutMs: deps.urlTimeoutMs ?? LOGIN_URL_TIMEOUT_MS,
      loginTtlMs: deps.loginTtlMs ?? LOGIN_TTL_MS,
    };
  }

  /** Current `claude auth status` (which account is signed in). Never rejects → {loggedIn:false} on error. */
  async status(): Promise<ClaudeAuthStatus> {
    return new Promise<ClaudeAuthStatus>((resolve) => {
      let child: ChildProcess;
      try {
        child = this.deps.spawn(["auth", "status"]);
      } catch {
        resolve({ loggedIn: false });
        return;
      }
      let out = "";
      let settled = false;
      const done = (s: ClaudeAuthStatus) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(s);
      };
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* gone */
        }
        done({ loggedIn: false });
      }, STATUS_TIMEOUT_MS);
      child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      child.on("error", () => done({ loggedIn: false }));
      child.on("close", () => done(parseAuthStatus(out)));
    });
  }

  /**
   * Start a login: spawn `claude auth login --claudeai`, resolve with the authorize URL once it's printed.
   * Supersedes any prior in-flight login. Rejects if the URL never appears (timeout / immediate exit).
   */
  async startLogin(): Promise<{ loginId: string; url: string }> {
    this.cancel(); // one in-flight login at a time
    return new Promise<{ loginId: string; url: string }>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.deps.spawn(["auth", "login", "--claudeai"]);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("failed to spawn claude"));
        return;
      }
      const id = randomUUID();
      let settled = false;
      let buf = "";
      const onData = (d: Buffer) => {
        buf += d.toString();
        const url = extractLoginUrl(buf);
        if (url && !settled) {
          settled = true;
          clearTimeout(timer);
          // Hand off to a PendingLogin that lives until the code arrives (or it self-expires).
          const expiry = setTimeout(() => this.cancelIf(id), this.deps.loginTtlMs);
          this.pending = { id, child, output: buf, startedAt: this.deps.now(), expiry };
          // Keep accumulating output (the success/error after the code is submitted).
          child.stdout?.on("data", (x: Buffer) => this.pending && (this.pending.output += x.toString()));
          child.stderr?.on("data", (x: Buffer) => this.pending && (this.pending.output += x.toString()));
          resolve({ loginId: id, url });
        }
      };
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.kill("SIGKILL");
        } catch {
          /* gone */
        }
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail("timed out waiting for the sign-in URL"), this.deps.urlTimeoutMs);
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", (e: Error) => fail(e.message));
      child.on("close", () => fail(buf.trim() || "claude exited before printing a sign-in URL"));
    });
  }

  /**
   * Submit the pasted authorization code for an in-flight login: write it to the subprocess stdin and
   * resolve once `claude` finishes the exchange. {ok:true} on a clean exit (fresh creds saved); {ok:false}
   * + message otherwise. `loginId` must match the in-flight login (else it's stale/unknown).
   */
  async submitCode(loginId: string, code: string): Promise<{ ok: boolean; message?: string }> {
    const p = this.pending;
    if (!p || p.id !== loginId) return { ok: false, message: "no sign-in is in progress (it may have expired)" };
    const trimmed = code.trim();
    if (!trimmed) return { ok: false, message: "the code is empty" };

    return new Promise<{ ok: boolean; message?: string }>((resolve) => {
      let settled = false;
      const done = (r: { ok: boolean; message?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.pending === p) {
          clearTimeout(p.expiry);
          this.pending = undefined;
        }
        resolve(r);
      };
      const timer = setTimeout(() => {
        try {
          p.child.kill("SIGKILL");
        } catch {
          /* gone */
        }
        done({ ok: false, message: "timed out completing sign-in" });
      }, STATUS_TIMEOUT_MS);
      p.child.on("close", (codeNum: number | null) => {
        // A clean exit (0) means the token exchange succeeded. Otherwise surface the tail of the output.
        if (codeNum === 0) done({ ok: true });
        else done({ ok: false, message: tail(p.output) || `sign-in failed (exit ${codeNum ?? "?"})` });
      });
      p.child.on("error", (e: Error) => done({ ok: false, message: e.message }));
      try {
        p.child.stdin?.write(trimmed + "\n");
        p.child.stdin?.end();
      } catch (e) {
        done({ ok: false, message: e instanceof Error ? e.message : "failed to submit the code" });
      }
    });
  }

  /** Abandon any in-flight login (e.g. the user cancels). */
  cancel(): void {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.expiry);
    try {
      p.child.kill("SIGKILL");
    } catch {
      /* gone */
    }
    this.pending = undefined;
  }

  private cancelIf(id: string): void {
    if (this.pending?.id === id) this.cancel();
  }
}

/** Last non-empty line of output (the error/success message claude prints), capped. */
function tail(output: string): string {
  const line = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) return "";
  return line.length > 200 ? line.slice(0, 197) + "…" : line;
}

/** Production wiring: spawn `claude <args>` with the server env (ANTHROPIC_API_KEY stripped → subscription
 *  auth, mirroring the chat/usage spawns). stdin is piped so the code can be written for the login flow. */
export function createClaudeAuthService(opts: {
  claudeBin: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}): ClaudeAuthService {
  return new ClaudeAuthService({
    spawn: (args) => {
      const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env) };
      delete env.ANTHROPIC_API_KEY;
      return nodeSpawn(opts.claudeBin, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    },
    now: opts.now ?? (() => Date.now()),
  });
}
