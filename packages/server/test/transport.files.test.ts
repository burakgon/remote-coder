import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SessionManager, createServer } from "../src/index.js";
import type { ServerRuntimeConfig, CreateServerResult } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };

let root: string;
let current: CreateServerResult | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rc-files-"));
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "readme.md"), "# hi");
});

afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
  rmSync(root, { recursive: true, force: true });
});

function makeServer(maxUploadBytes = 26214400): CreateServerResult {
  const config: ServerRuntimeConfig = {
    port: 0,
    bindAddress: "127.0.0.1",
    accessToken: TOKEN,
    fsRoot: root,
    maxUploadBytes,
    claude: { claudeBin: process.execPath },
  };
  const manager = new SessionManager(config.claude, {
    spawnPrefixArgs: [MOCK],
    baseEnv: { ...process.env, MOCK_MODE: "simple" },
    startTimeoutMs: 5000,
  });
  return createServer(config, manager);
}

test("GET /fs/list returns the listing rooted at fsRoot", async () => {
  current = makeServer();
  const res = await current.app.inject({ method: "GET", url: "/fs/list", headers: auth });
  expect(res.statusCode).toBe(200);
  const names = res.json().entries.map((e: { name: string }) => e.name);
  expect(names).toEqual(["sub", "readme.md"]); // dir first, then file
});

test("GET /fs/list rejects path traversal with 400", async () => {
  current = makeServer();
  const res = await current.app.inject({ method: "GET", url: "/fs/list?path=../..", headers: auth });
  expect(res.statusCode).toBe(400);
});

test("GET /fs/download streams a file with an attachment header", async () => {
  current = makeServer();
  const res = await current.app.inject({
    method: "GET",
    url: `/fs/download?path=${encodeURIComponent(join(root, "readme.md"))}`,
    headers: auth,
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-disposition"]).toContain('filename="readme.md"');
  expect(res.body).toBe("# hi");
});

test("POST /fs/upload writes a file under the target dir", async () => {
  current = makeServer();
  const boundary = "----rcboundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="note.txt"\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    `uploaded-content\r\n` +
    `--${boundary}--\r\n`;
  const res = await current.app.inject({
    method: "POST",
    url: `/fs/upload?dir=${encodeURIComponent(join(root, "sub"))}`,
    headers: { ...auth, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().path).toBe(join(root, "sub", "note.txt"));

  // confirm it is downloadable
  const back = await current.app.inject({
    method: "GET",
    url: `/fs/download?path=${encodeURIComponent(join(root, "sub", "note.txt"))}`,
    headers: auth,
  });
  expect(back.body).toBe("uploaded-content");
});

test("POST /fs/upload rejects a file over the size cap with 413", async () => {
  current = makeServer(8); // 8-byte cap
  const boundary = "----rcboundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="big.txt"\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    `this content is definitely longer than eight bytes\r\n` +
    `--${boundary}--\r\n`;
  const res = await current.app.inject({
    method: "POST",
    url: `/fs/upload?dir=${encodeURIComponent(root)}`,
    headers: { ...auth, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  expect(res.statusCode).toBe(413);
});
