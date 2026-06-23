import { expect, test } from "vitest";
import { classifyQuestionRequest, serializeHookQuestionAnswer, classifyPermissionRequest } from "../src/index.js";
import type { ControlRequestEvent } from "../src/index.js";

function hookReq(toolName: string, toolInput: unknown): ControlRequestEvent {
  return {
    type: "control_request",
    requestId: "rq-1",
    subtype: "hook_callback",
    request: {
      subtype: "hook_callback",
      callback_id: "hook_0",
      tool_use_id: "tu-1",
      input: { tool_name: toolName, tool_input: toolInput },
    },
    raw: {},
  };
}

test("classifyQuestionRequest extracts questions for an AskUserQuestion hook", () => {
  const ev = hookReq("AskUserQuestion", {
    questions: [
      {
        question: "Pick a language",
        header: "Language",
        multiSelect: false,
        options: [{ label: "TypeScript", description: "TS" }, { label: "Python" }],
      },
    ],
  });
  const q = classifyQuestionRequest(ev);
  expect(q?.requestId).toBe("rq-1");
  expect(q?.toolUseId).toBe("tu-1");
  expect(q?.questions[0]?.question).toBe("Pick a language");
  expect(q?.questions[0]?.multiSelect).toBe(false);
  expect(q?.questions[0]?.options.map((o) => o.label)).toEqual(["TypeScript", "Python"]);
});

test("classifyQuestionRequest returns null for a non-AskUserQuestion hook", () => {
  expect(classifyQuestionRequest(hookReq("Write", { file_path: "/x" }))).toBeNull();
});

test("serializeHookQuestionAnswer produces an allow with updatedInput.answers", () => {
  const toolInput = { questions: [{ question: "Pick a language", options: [{ label: "TypeScript" }] }] };
  const line = serializeHookQuestionAnswer("rq-1", toolInput, { "Pick a language": "TypeScript" });
  const obj = JSON.parse(line);
  expect(obj.type).toBe("control_response");
  expect(obj.response.request_id).toBe("rq-1");
  const out = obj.response.response.hookSpecificOutput;
  expect(out.permissionDecision).toBe("allow");
  expect(out.hookEventName).toBe("PreToolUse");
  expect(out.updatedInput.answers).toEqual({ "Pick a language": "TypeScript" });
  expect(out.updatedInput.questions).toEqual(toolInput.questions); // original input carried through
});

test("an AskUserQuestion hook is NOT misread as an ordinary permission gate by question-aware code", () => {
  // classifyPermissionRequest still returns it as a hook_callback (toolName AskUserQuestion);
  // the server uses classifyQuestionRequest FIRST so it never double-fires.
  const ev = hookReq("AskUserQuestion", { questions: [] });
  expect(classifyPermissionRequest(ev)?.toolName).toBe("AskUserQuestion");
  expect(classifyQuestionRequest(ev)).not.toBeNull();
});
