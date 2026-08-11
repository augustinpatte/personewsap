import { describe, expect, it } from "vitest";

import {
  beginLanguageSave,
  createLanguageSaveLockState,
  finishLanguageSave,
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

  it("serializes language persistence while a save is in flight", () => {
    const first = beginLanguageSave(createLanguageSaveLockState());
    expect(first.started).toBe(true);
    if (!first.started) {
      throw new Error("first language save did not start");
    }

    const second = beginLanguageSave(first.state);
    expect(second.started).toBe(false);

    const finished = finishLanguageSave(first.state, first.requestId);
    const third = beginLanguageSave(finished);
    expect(third.started).toBe(true);
  });
});
