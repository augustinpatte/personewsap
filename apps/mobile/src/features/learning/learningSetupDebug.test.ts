import { describe, expect, it } from "vitest";

import { getLearningSetupDebugError } from "./learningSetupDebug";

describe("learning setup debug error", () => {
  const error = {
    code: "PGRST123",
    message: "relation does not exist",
    details: "missing table",
    hint: "run migration"
  };

  it("returns null outside dev", () => {
    expect(getLearningSetupDebugError(error, false)).toBeNull();
  });

  it("returns technical text in dev", () => {
    expect(getLearningSetupDebugError(error, true)).toContain("code: PGRST123");
    expect(getLearningSetupDebugError(error, true)).toContain("message: relation does not exist");
    expect(getLearningSetupDebugError(error, true)).toContain("details: missing table");
    expect(getLearningSetupDebugError(error, true)).toContain("hint: run migration");
  });

  it("returns null for a null error", () => {
    expect(getLearningSetupDebugError(null, true)).toBeNull();
  });
});
