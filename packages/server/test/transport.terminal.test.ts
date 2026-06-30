// packages/server/test/transport.terminal.test.ts
import { expect, test } from "vitest";
import { buildTestServer } from "./helpers/test-server.js";

test("POST /sessions {mode:'terminal'} creates a terminal session", async () => {
  const { app, token } = await buildTestServer({ terminalAvailable: true });
  const res = await app.inject({
    method: "POST",
    url: "/sessions",
    headers: { authorization: `Bearer ${token}` },
    payload: { cwd: process.cwd(), mode: "terminal" },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().mode).toBe("terminal");
  await app.close();
});

test("terminal create is rejected when unsupported", async () => {
  const { app, token } = await buildTestServer({ terminalAvailable: false });
  const res = await app.inject({
    method: "POST",
    url: "/sessions",
    headers: { authorization: `Bearer ${token}` },
    payload: { cwd: process.cwd(), mode: "terminal" },
  });
  expect(res.statusCode).toBe(400);
  await app.close();
});

test("GET /version reports terminalAvailable", async () => {
  const { app, token } = await buildTestServer({ terminalAvailable: true });
  const res = await app.inject({ method: "GET", url: "/version", headers: { authorization: `Bearer ${token}` } });
  expect(res.json().terminalAvailable).toBe(true);
  await app.close();
});
