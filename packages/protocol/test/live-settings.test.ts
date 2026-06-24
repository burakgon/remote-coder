import { expect, test } from "vitest";
import {
  serializeSetModel,
  serializeSetMaxThinkingTokens,
  serializeSetPermissionMode,
  serializeInterrupt,
} from "../src/index.js";

test("serializeSetModel builds a set_model control_request", () => {
  const obj = JSON.parse(serializeSetModel("claude-opus-4-8"));
  expect(obj.type).toBe("control_request");
  expect(typeof obj.request_id).toBe("string");
  expect(obj.request).toEqual({ subtype: "set_model", model: "claude-opus-4-8" });
});

test("serializeSetMaxThinkingTokens builds a set_max_thinking_tokens control_request", () => {
  const obj = JSON.parse(serializeSetMaxThinkingTokens(8000));
  expect(obj.request).toEqual({ subtype: "set_max_thinking_tokens", max_thinking_tokens: 8000 });
});

test("serializeSetMaxThinkingTokens carries an optional thinking_display", () => {
  const obj = JSON.parse(serializeSetMaxThinkingTokens(8000, { thinkingDisplay: "summarized" }));
  expect(obj.request).toEqual({
    subtype: "set_max_thinking_tokens",
    max_thinking_tokens: 8000,
    thinking_display: "summarized",
  });
});

test("serializeSetMaxThinkingTokens accepts null to clear the budget", () => {
  const obj = JSON.parse(serializeSetMaxThinkingTokens(null));
  expect(obj.request).toEqual({ subtype: "set_max_thinking_tokens", max_thinking_tokens: null });
});

test("serializeSetPermissionMode builds a set_permission_mode control_request", () => {
  const obj = JSON.parse(serializeSetPermissionMode("acceptEdits"));
  expect(obj.request).toEqual({ subtype: "set_permission_mode", mode: "acceptEdits" });
});

test("serializeInterrupt builds an interrupt control_request", () => {
  const obj = JSON.parse(serializeInterrupt());
  expect(obj.type).toBe("control_request");
  expect(typeof obj.request_id).toBe("string");
  expect(obj.request).toEqual({ subtype: "interrupt" });
});

test("serializeInterrupt honors an explicit requestId", () => {
  const obj = JSON.parse(serializeInterrupt("stop-1"));
  expect(obj.request_id).toBe("stop-1");
  expect(obj.request).toEqual({ subtype: "interrupt" });
});

test("an explicit requestId is honored", () => {
  const obj = JSON.parse(serializeSetModel("m", { requestId: "fixed-id" }));
  expect(obj.request_id).toBe("fixed-id");
});
