import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { FsService, FsError } from "./fs-service.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { WebSocket } from "ws";
import { SessionHub } from "./session-hub.js";
import { AuthGate, extractBearerToken } from "./auth.js";
import { buildImageBlock } from "@remote-coder/protocol";
import type { ContentBlock, HookPermissionDecision } from "@remote-coder/protocol";
import type { SessionManager } from "./session-manager.js";
import type { ServerRuntimeConfig } from "./server-config.js";

export interface CreateServerResult {
  app: FastifyInstance;
  hub: SessionHub;
  authGate: AuthGate;
}

interface CreateSessionBody {
  cwd: string;
  model?: string;
  effort?: string;
  addDirs?: string[];
  dangerouslySkip?: boolean;
}

export function createServer(
  config: ServerRuntimeConfig,
  sessionManager: SessionManager,
): CreateServerResult {
  const hub = new SessionHub(sessionManager);
  const authGate = new AuthGate({ token: config.accessToken });
  const fsService = new FsService({ root: config.fsRoot });
  // trustProxy makes request.ip honour X-Forwarded-For behind a reverse proxy, so the
  // per-client auth lockout keys on the real client IP (see Task 4's proxy caveat).
  const app = Fastify({ logger: false, trustProxy: config.trustProxy ?? false });

  // Multipart uploads, capped at the configured size.
  app.register(multipart, { limits: { fileSize: config.maxUploadBytes } });

  // Global token gate — applies to BOTH REST routes AND the WebSocket upgrade request
  // (a Fastify global preHandler runs for the WS route's GET upgrade and a 401 there
  // aborts the upgrade — verified). The token for a WS upgrade may arrive in the
  // Authorization header or the `?token=` query param, so accept either here.
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    // No token configured (loopback dev): allow. Non-loopback w/o token is blocked at startup.
    if (!config.accessToken) return;
    // `?token=a&token=b` parses to an array — only a single string is a usable token.
    // Anything else (array, missing) becomes undefined so the auth path can't be fed a non-string.
    const q = request.query as { token?: unknown };
    const queryToken = typeof q?.token === "string" ? q.token : undefined;
    const token = extractBearerToken(request.headers.authorization) ?? queryToken;
    const result = authGate.check(token, request.ip);
    if (!result.ok) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
  });

  // WebSocket support. Registered synchronously; routes are added below.
  app.register(websocket);

  // Handshake auth is handled by the GLOBAL preHandler (it runs for the upgrade GET and
  // reads ?token= too). By the time this handler runs, the token is already validated;
  // we only reject an unknown session here.
  app.register(async (wsScope) => {
    wsScope.get<{ Params: { id: string }; Querystring: { since?: string } }>(
      "/sessions/:id/ws",
      { websocket: true },
      (socket: WebSocket, request: FastifyRequest<{ Params: { id: string }; Querystring: { since?: string } }>) => {
        const id = request.params.id;

        if (!hub.getSession(id)) {
          socket.close(4404, "session not found");
          return;
        }

        // Optional delta replay: `?since=<seq>` replays only frames AFTER that seq (reconnect
        // without re-receiving the whole buffer). Ignore an absent/invalid value (full replay).
        const sinceRaw = request.query.since;
        const sinceParsed = sinceRaw === undefined ? NaN : Number(sinceRaw);
        const sinceSeq =
          Number.isInteger(sinceParsed) && sinceParsed >= 0 ? sinceParsed : undefined;

        // SessionHub fan-out is SYNCHRONOUS: a throw from socket.send() (e.g. the socket is
        // closing) would unwind the hub's listener loop straight into the ClaudeProcess emit.
        // Guard the send and, on ANY failure, unsubscribe + close so the throw never escapes
        // the hub callback.
        const subscription = hub.subscribe(id, (frame) => {
          if (socket.readyState !== socket.OPEN) return;
          try {
            socket.send(JSON.stringify(frame));
          } catch {
            subscription.unsubscribe();
            try {
              socket.close();
            } catch {
              // socket already torn down — nothing more to do
            }
          }
        }, sinceSeq);

        socket.on("message", (raw: Buffer) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(raw.toString());
          } catch {
            return; // ignore malformed client frames
          }
          handleClientFrame(hub, id, msg);
        });

        socket.on("close", () => subscription.unsubscribe());
        socket.on("error", () => subscription.unsubscribe());
      },
    );
  });

  app.post<{ Body: CreateSessionBody }>("/sessions", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body.cwd !== "string") {
      reply.code(400).send({ error: "cwd is required" });
      return;
    }
    const session = await hub.createSession({
      cwd: body.cwd,
      model: body.model,
      effort: body.effort,
      addDirs: body.addDirs,
      dangerouslySkip: body.dangerouslySkip,
    });
    reply.code(201).send({ session });
  });

  app.get("/sessions", async () => {
    return { sessions: hub.listSessions() };
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    const meta = hub.getSession(request.params.id);
    if (!meta) {
      reply.code(404).send({ error: "session not found" });
      return;
    }
    return { session: meta, history: hub.getHistory(request.params.id) };
  });

  app.post<{ Params: { id: string } }>("/sessions/:id/stop", async (request, reply) => {
    const meta = hub.getSession(request.params.id);
    if (!meta) {
      reply.code(404).send({ error: "session not found" });
      return;
    }
    hub.stopSession(request.params.id);
    return { ok: true };
  });

  app.get<{ Querystring: { path?: string } }>("/fs/list", async (request, reply) => {
    try {
      const target = request.query.path ?? config.fsRoot;
      return await fsService.listDirectory(target);
    } catch (err) {
      if (err instanceof FsError) {
        reply.code(err.code === "forbidden" ? 403 : 404).send({ error: err.message });
      } else {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  });

  app.get<{ Querystring: { path?: string } }>("/fs/download", async (request, reply) => {
    if (!request.query.path) {
      reply.code(400).send({ error: "path is required" });
      return;
    }
    try {
      const file = await fsService.readFileForDownload(request.query.path);
      reply
        .header("content-disposition", contentDisposition(file.filename))
        .header("content-type", "application/octet-stream")
        .send(file.data);
    } catch (err) {
      if (err instanceof FsError) {
        reply.code(err.code === "forbidden" ? 403 : 404).send({ error: err.message });
      } else {
        reply.code(404).send({ error: (err as Error).message });
      }
    }
  });

  app.post<{ Querystring: { dir?: string } }>("/fs/upload", async (request, reply) => {
    const targetDir = request.query.dir ?? config.fsRoot;
    let data;
    try {
      data = await request.file();
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
      return;
    }
    if (!data) {
      reply.code(400).send({ error: "no file field in the upload" });
      return;
    }
    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err) {
      // @fastify/multipart throws when the per-file limit is exceeded.
      reply.code(413).send({ error: (err as Error).message });
      return;
    }
    if (data.file.truncated) {
      reply.code(413).send({ error: "file exceeds the upload size limit" });
      return;
    }
    try {
      const written = await fsService.writeUploadedFile(targetDir, data.filename, buffer);
      reply.code(201).send({ path: written.path });
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Graceful shutdown: app.close() must tear down every live session's child `claude`
  // process, or they leak as orphans (SIGTERM/SIGINT in start.ts close the app).
  app.addHook("onClose", async () => {
    hub.stopAll();
  });

  return { app, hub, authGate };
}

/**
 * Build a safe `Content-Disposition` value for a download. A filename containing `"`, `\`, or a
 * CR/LF could break out of the header (header injection) or corrupt the quoted-string. We strip
 * control chars for the ASCII `filename=` fallback (quotes/backslashes escaped) and carry the full
 * UTF-8 name via RFC 5987 `filename*=` (percent-encoded), which modern clients prefer.
 */
function contentDisposition(filename: string): string {
  // Drop control chars (incl. CR/LF) from the ASCII fallback, then escape `\` and `"`.
  const ascii = filename.replace(/[\x00-\x1f\x7f"\\]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function handleClientFrame(hub: SessionHub, id: string, msg: Record<string, unknown>): void {
  if (msg.type === "user") {
    const blocks = toContentBlocks(msg);
    if (blocks.length > 0) hub.sendMessage(id, blocks);
    return;
  }
  if (msg.type === "permission") {
    const requestId = typeof msg.requestId === "string" ? msg.requestId : undefined;
    const decision =
      msg.decision === "allow" || msg.decision === "deny" ? (msg.decision as HookPermissionDecision) : undefined;
    if (requestId && decision) {
      const reason = typeof msg.reason === "string" ? msg.reason : undefined;
      hub.answerPermission(id, requestId, decision, reason);
    }
    return;
  }
  // unknown frame types are ignored
}

/** A content block is only forwarded if it is a well-formed text or image block. */
function isValidContentBlock(b: unknown): b is ContentBlock {
  if (typeof b !== "object" || b === null) return false;
  const block = b as Record<string, unknown>;
  if (block.type === "text") return typeof block.text === "string";
  if (block.type === "image") {
    const src = block.source as Record<string, unknown> | undefined;
    return (
      typeof src === "object" &&
      src !== null &&
      src.type === "base64" &&
      typeof src.media_type === "string" &&
      typeof src.data === "string"
    );
  }
  return false;
}

/** Build a content-block array from a flexible inbound `user` frame. Never forwards arbitrary JSON. */
function toContentBlocks(msg: Record<string, unknown>): ContentBlock[] {
  // Explicit `blocks` array: keep only well-formed text/image blocks (don't cast raw client JSON
  // straight into serializeUserMessage -> claude stdin).
  if (Array.isArray(msg.blocks)) return msg.blocks.filter(isValidContentBlock);
  const blocks: ContentBlock[] = [];
  const text =
    typeof msg.content === "string" ? msg.content : typeof msg.text === "string" ? msg.text : undefined;
  if (text) blocks.push({ type: "text", text });
  if (Array.isArray(msg.images)) {
    for (const img of msg.images as { mediaType?: string; dataBase64?: string }[]) {
      if (img && typeof img.mediaType === "string" && typeof img.dataBase64 === "string") {
        blocks.push(buildImageBlock(img.mediaType, img.dataBase64));
      }
    }
  }
  return blocks;
}
