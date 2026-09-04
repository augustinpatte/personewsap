import { describe, expect, it } from "vitest";

import { resolveEditionProgress } from "./editionProgress";
import { getModuleCopy } from "./moduleCopy";

/**
 * The finite session, made visible.
 *
 * DailyDropContext has always counted how far through today's edition a reader
 * is and no screen ever showed it, so the one promise that separates PersoNews
 * from a feed — this ends — was invisible. These cases pin both halves: the
 * arithmetic, and the sentence it produces in each language.
 */

const ready = { status: "ready" as const, isLiveEdition: true };

describe("edition progress arithmetic", () => {
  it("reports nothing read yet", () => {
    expect(
      resolveEditionProgress({ ...ready, completedItemCount: 0, totalItemCount: 3 })
    ).toEqual({ kind: "inProgress", completed: 0, total: 3, ratio: 0 });
  });

  it("reports a part-finished edition", () => {
    const state = resolveEditionProgress({
      ...ready,
      completedItemCount: 2,
      totalItemCount: 3
    });

    expect(state.kind).toBe("inProgress");
    if (state.kind === "inProgress") {
      expect(state.completed).toBe(2);
      expect(state.total).toBe(3);
      expect(state.ratio).toBeCloseTo(2 / 3);
    }
  });

  it("reports completion once every reading is done", () => {
    expect(
      resolveEditionProgress({ ...ready, completedItemCount: 3, totalItemCount: 3 })
    ).toEqual({ kind: "complete", total: 3 });
  });

  it("follows the reader as they finish one more", () => {
    const kinds = [0, 1, 2, 3].map(
      (completed) =>
        resolveEditionProgress({ ...ready, completedItemCount: completed, totalItemCount: 3 })
          .kind
    );

    expect(kinds).toEqual(["inProgress", "inProgress", "inProgress", "complete"]);
  });

  it("shows nothing rather than 0 of 0 on a quiet day", () => {
    expect(
      resolveEditionProgress({ ...ready, completedItemCount: 0, totalItemCount: 0 })
    ).toEqual({ kind: "hidden" });
  });

  it("shows nothing while the edition is still loading", () => {
    expect(
      resolveEditionProgress({
        completedItemCount: 1,
        totalItemCount: 3,
        isLiveEdition: true,
        status: "loading"
      })
    ).toEqual({ kind: "hidden" });
  });

  it("never counts a sample or offline fallback edition", () => {
    // A mock drop has items but no real interaction history, so any number
    // printed over it would be invented.
    expect(
      resolveEditionProgress({
        completedItemCount: 0,
        totalItemCount: 5,
        isLiveEdition: false,
        status: "ready"
      })
    ).toEqual({ kind: "hidden" });
  });

  it("cannot report more read than the edition contains", () => {
    expect(
      resolveEditionProgress({ ...ready, completedItemCount: 9, totalItemCount: 3 })
    ).toEqual({ kind: "complete", total: 3 });
  });

  it("survives a nonsense count without rendering a nonsense line", () => {
    expect(
      resolveEditionProgress({
        ...ready,
        completedItemCount: Number.NaN,
        totalItemCount: 3
      })
    ).toEqual({ kind: "inProgress", completed: 0, total: 3, ratio: 0 });
  });
});

describe("edition progress copy", () => {
  it("reads naturally in English", () => {
    const copy = getModuleCopy("en").common;

    expect(copy.editionProgress(2, 3)).toBe("2 of 3 completed today");
    expect(copy.editionProgress(0, 3)).toBe("0 of 3 completed today");
    expect(copy.editionComplete).toBe("Edition complete");
  });

  it("reads naturally in French, and agrees in number", () => {
    const copy = getModuleCopy("fr").common;

    expect(copy.editionProgress(2, 3)).toBe("2 sur 3 terminés aujourd'hui");
    // One reading finished is singular; none is too.
    expect(copy.editionProgress(1, 3)).toBe("1 sur 3 terminé aujourd'hui");
    expect(copy.editionProgress(0, 3)).toBe("0 sur 3 terminé aujourd'hui");
    expect(copy.editionComplete).toBe("Édition terminée");
  });

  it("switches language immediately, with no stored copy in between", () => {
    // The screens read this through getModuleCopy(language) on every render,
    // so a language change re-renders straight into the other sentence.
    expect(getModuleCopy("fr").common.editionProgress(2, 3)).not.toBe(
      getModuleCopy("en").common.editionProgress(2, 3)
    );
  });
});
