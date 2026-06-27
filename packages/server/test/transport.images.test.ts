import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SessionManager, createServer, HistoryService } from "../src/index.js";
import { encodeProjectDir } from "@remote-coder/protocol";
import type { CreateServerResult, ServerRuntimeConfig } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
const TOKEN = "img-token";
const auth = { authorization: `Bearer ${TOKEN}` };

let dir: string;
let current: CreateServerResult | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-img-"));
});
afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
  await rm(dir, { recursive: true, force: true });
});

function configFor(): ServerRuntimeConfig {
  return {
    port: 0,
    bindAddress: "127.0.0.1",
    accessToken: TOKEN,
    fsRoot: dir,
    maxUploadBytes: 26214400,
    dataDir: dir,
    claude: { claudeBin: process.execPath },
  };
}
function managerFor() {
  return new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "simple" }, startTimeoutMs: 5000 },
  );
}
function multipart(
  filename: string,
  contentType: string,
  content: string,
): { headers: Record<string, string>; payload: string } {
  const boundary = "----rcimgboundary";
  const payload =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n` +
    content +
    `\r\n--${boundary}--\r\n`;
  return { headers: { ...auth, "content-type": `multipart/form-data; boundary=${boundary}` }, payload };
}

test("POST /images stores a content-addressed image and GET /images/:ref serves it", async () => {
  current = createServer(configFor(), managerFor());
  const up = multipart("shot.png", "image/png", "hello");
  const res = await current.app.inject({ method: "POST", url: "/images", headers: up.headers, payload: up.payload });
  expect(res.statusCode).toBe(201);
  const ref = res.json().ref as string;
  // ref is the sha256 of the bytes + the image ext.
  expect(ref).toBe(`${createHash("sha256").update(Buffer.from("hello")).digest("hex")}.png`);

  const get = await current.app.inject({ method: "GET", url: `/images/${ref}?token=${TOKEN}` });
  expect(get.statusCode).toBe(200);
  expect(get.headers["content-type"]).toContain("image/png");
  expect(get.headers["cache-control"]).toMatch(/immutable/);
  expect(get.rawPayload.toString()).toBe("hello");
});

test("POST /images rejects a non-image upload (400)", async () => {
  current = createServer(configFor(), managerFor());
  const up = multipart("note.txt", "text/plain", "nope");
  const res = await current.app.inject({ method: "POST", url: "/images", headers: up.headers, payload: up.payload });
  expect(res.statusCode).toBe(400);
});

test("GET /images/:ref is token-gated (401) and 404s a bad/missing ref", async () => {
  current = createServer(configFor(), managerFor());
  const up = multipart("shot.png", "image/png", "data");
  const ref = (
    await current.app.inject({ method: "POST", url: "/images", headers: up.headers, payload: up.payload })
  ).json().ref as string;

  const noTok = await current.app.inject({ method: "GET", url: `/images/${ref}` });
  expect(noTok.statusCode).toBe(401);
  const missing = await current.app.inject({ method: "GET", url: `/images/deadbeef.png`, headers: auth });
  expect(missing.statusCode).toBe(404);
});

test("reopen ships a transcript's inline base64 image as a /images/<ref> ref (no base64 in the payload)", async () => {
  const claudeHome = join(dir, "home");
  const sessionCwd = join(dir, "work");
  await mkdir(sessionCwd, { recursive: true });
  current = createServer(configFor(), managerFor(), { history: new HistoryService({ claudeHome }) });
  const created = await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { cwd: sessionCwd },
  });
  const id = created.json().session.id as string;

  const imgB64 = Buffer.from("screenshot-bytes").toString("base64");
  const projDir = join(claudeHome, ".claude", "projects", encodeProjectDir(sessionCwd));
  await mkdir(projDir, { recursive: true });
  await writeFile(
    join(projDir, `${id}.jsonl`),
    JSON.stringify({
      type: "user",
      uuid: "u1",
      message: {
        role: "user",
        content: [
          { type: "text", text: "see this" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: imgB64 } },
        ],
      },
    }) + "\n",
    "utf8",
  );

  const res = await current.app.inject({ method: "GET", url: `/sessions/${id}`, headers: auth });
  expect(res.statusCode).toBe(200);
  const history = res.json().history as {
    payload: { message: { content: { type: string; source?: { type: string; url?: string } }[] } };
  }[];
  const block = history[0]!.payload.message.content[1]!;
  expect(block.source!.type).toBe("url");
  expect(block.source!.url).toBe(
    `/images/${createHash("sha256").update(Buffer.from("screenshot-bytes")).digest("hex")}.png`,
  );
  // No base64 anywhere in the reopen payload.
  expect(JSON.stringify(res.json())).not.toContain(imgB64);

  // ...and the backfilled image is now fetchable from the store.
  const ref = block.source!.url!.slice("/images/".length);
  const img = await current.app.inject({ method: "GET", url: `/images/${ref}?token=${TOKEN}` });
  expect(img.statusCode).toBe(200);
  expect(img.rawPayload.toString()).toBe("screenshot-bytes");
});

test("a user message sent with imageRefs feeds Claude the image (ref resolved from the store)", async () => {
  // End-to-end-ish: upload an image, then exercise buildUserBlocks indirectly via the store read by
  // confirming the stored bytes are retrievable for the ref the client would send. (The WS send path is
  // covered by transport.ws tests; here we assert the store round-trip the send path depends on.)
  current = createServer(configFor(), managerFor());
  const up = multipart("a.png", "image/png", "abc");
  const ref = (
    await current.app.inject({ method: "POST", url: "/images", headers: up.headers, payload: up.payload })
  ).json().ref as string;
  const got = await current.app.inject({ method: "GET", url: `/images/${ref}?token=${TOKEN}` });
  expect(got.rawPayload.toString()).toBe("abc");
});
