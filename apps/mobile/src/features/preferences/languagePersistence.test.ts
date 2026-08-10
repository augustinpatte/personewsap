import { describe, expect, it } from "vitest";

import {
  shouldApplyLanguageSaveResult,
  shouldRollbackLanguageSelection
} from "./languagePersistence";

describe("account language persistence", () => {
  it("rolls back only the latest failed language save", () => {
    expect(
      shouldRollbackLanguageSelection({
        persisted: false,
        requestId: 2,
        latestRequestId: 2
      })
    ).toBe(true);
  });

  it("does not let an old failed save roll back a newer language choice", () => {
    expect(
      shouldRollbackLanguageSelection({
        persisted: false,
        requestId: 1,
        latestRequestId: 2
      })
    ).toBe(false);
    expect(shouldApplyLanguageSaveResult({ requestId: 1, latestRequestId: 2 })).toBe(false);
  });
});
