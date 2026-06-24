import { expect, test } from "vitest";
import { deliver, askDeliver, createMcpSendServer } from "../src/mcp-send.js";
import type { McpEnv, AskQuestion } from "../src/mcp-send.js";

const ENV: McpEnv = {
  RC_BASE_URL: "http://127.0.0.1:4280",
  RC_SESSION_ID: "sess-1",
  RC_TOKEN: "tok-1",
};

test("deliver POSTs to the attach endpoint with bearer auth + json body and returns a success result", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    captured = { url: String(url), init: init as RequestInit };
    return new Response(JSON.stringify({ ok: true, id: "att-1" }), { status: 200 });
  };

  const result = await deliver(ENV, { path: "/root/pic.png", caption: "look", kind: "image" }, fetchImpl);

  expect(captured?.url).toBe("http://127.0.0.1:4280/sessions/sess-1/attach");
  expect(captured?.init.method).toBe("POST");
  const headers = captured?.init.headers as Record<string, string>;
  expect(headers.authorization).toBe("Bearer tok-1");
  expect(headers["content-type"]).toBe("application/json");
  expect(JSON.parse(captured?.init.body as string)).toEqual({
    path: "/root/pic.png",
    caption: "look",
    kind: "image",
  });

  expect(result.isError).toBeFalsy();
  expect(result.content[0]).toEqual({ type: "text", text: "Sent pic.png to the user." });
});

test("deliver maps a non-ok HTTP response to an error tool-result with the server's message", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "path is outside the allowed root: ../x" }), { status: 403 });

  const result = await deliver(ENV, { path: "../x", kind: "image" }, fetchImpl);

  expect(result.isError).toBe(true);
  expect(result.content[0].type).toBe("text");
  expect(result.content[0].text).toContain("path is outside the allowed root");
});

test("deliver never throws on a network error — it returns an error tool-result", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("ECONNREFUSED");
  };

  const result = await deliver(ENV, { path: "/root/pic.png", kind: "file" }, fetchImpl);

  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("ECONNREFUSED");
});

test("deliver returns an error result when required env is missing (no crash)", async () => {
  const fetchImpl: typeof fetch = async () => new Response("{}", { status: 200 });
  const result = await deliver({}, { path: "/root/pic.png", kind: "file" }, fetchImpl);
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(/RC_BASE_URL|RC_SESSION_ID|RC_TOKEN|not configured/i);
});

const QUESTIONS: AskQuestion[] = [
  { question: "Which language?", header: "Language", options: [{ label: "TypeScript" }, { label: "Python" }] },
];

test("createMcpSendServer registers ask_user alongside send_image/send_file", async () => {
  const server = createMcpSendServer(ENV);
  // The SDK exposes registered tools on the internal registry; assert all three names are present.
  const registered = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
  expect(Object.keys(registered).sort()).toEqual(["ask_user", "send_file", "send_image"]);
});

test("askDeliver POSTs questions to /ask with bearer auth and returns the user's answer as text", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    captured = { url: String(url), init: init as RequestInit };
    return new Response(JSON.stringify({ answers: { "Which language?": "Python" } }), { status: 200 });
  };

  const result = await askDeliver(ENV, { questions: QUESTIONS }, fetchImpl);

  expect(captured?.url).toBe("http://127.0.0.1:4280/sessions/sess-1/ask");
  expect(captured?.init.method).toBe("POST");
  const headers = captured?.init.headers as Record<string, string>;
  expect(headers.authorization).toBe("Bearer tok-1");
  expect(JSON.parse(captured?.init.body as string)).toEqual({ questions: QUESTIONS });

  expect(result.isError).toBeFalsy();
  // Uses the header when present, and the chosen label.
  expect(result.content[0].text).toBe("User answered:\n- Language: Python");
});

test("askDeliver joins multi-select answers (incl. a custom Other entry) with commas", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ answers: { "Pick toppings": ["Cheese", "Pineapple (custom)"] } }), { status: 200 });
  const result = await askDeliver(
    ENV,
    { questions: [{ question: "Pick toppings", options: [{ label: "Cheese" }] }] },
    fetchImpl,
  );
  expect(result.content[0].text).toBe("User answered:\n- Pick toppings: Cheese, Pineapple (custom)");
});

test("askDeliver returns a graceful (non-error) result when the user is cancelled/timed out", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ cancelled: true }), { status: 200 });
  const result = await askDeliver(ENV, { questions: QUESTIONS }, fetchImpl);
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toMatch(/did not answer/i);
});

test("askDeliver never throws on a network error — graceful 'did not answer' result", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const result = await askDeliver(ENV, { questions: QUESTIONS }, fetchImpl);
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toMatch(/did not answer/i);
});

test("askDeliver maps a non-ok HTTP response to a graceful 'did not answer' result", async () => {
  const fetchImpl: typeof fetch = async () => new Response("nope", { status: 404 });
  const result = await askDeliver(ENV, { questions: QUESTIONS }, fetchImpl);
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toMatch(/did not answer/i);
});

test("askDeliver returns an error result when required env is missing (no crash)", async () => {
  const fetchImpl: typeof fetch = async () => new Response("{}", { status: 200 });
  const result = await askDeliver({}, { questions: QUESTIONS }, fetchImpl);
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(/RC_BASE_URL|RC_SESSION_ID|RC_TOKEN|not configured/i);
});
