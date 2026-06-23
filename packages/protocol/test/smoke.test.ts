import { expect, test } from "vitest";
import { PROTOCOL_PACKAGE } from "../src/index.js";

test("package is importable", () => {
  expect(PROTOCOL_PACKAGE).toBe("@remote-coder/protocol");
});
