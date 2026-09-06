import { describe, expect, it } from "vitest";

import type { MiniCaseOption } from "../today/contentTypes";
import {
  isServerScorableMiniCase,
  normalizeMiniCaseOption,
  normalizeMiniCaseOptions,
  outcomeForTier
} from "./legacyMiniCaseOptions";

/**
 * Three generations of Mini Case, one reader.
 *
 * The launch catalog is approved, published and sitting in readers' archives.
 * None of it is going to be regenerated to rename a field, so the reader has to
 * open a case written under any of the three shapes without crashing — and
 * without quietly pretending a binary case has a four-tier ranking it never had.
 */

function option(overrides: Record<string, unknown> = {}): MiniCaseOption {
  return {
    id: "a",
    label: "Compare the margin impact against the volume commitment",
    outcome: "best",
    feedback: "Right: the constraint is margin.",
    ...overrides
  } as MiniCaseOption;
}

describe("the graded shape", () => {
  it("reads the four tiers", () => {
    const { options, graded } = normalizeMiniCaseOptions([
      option({ id: "a", score_milli: 1000, outcome: undefined }),
      option({ id: "b", score_milli: 600, outcome: undefined }),
      option({ id: "c", score_milli: 300, outcome: undefined }),
      option({ id: "d", score_milli: 0, outcome: undefined })
    ] as MiniCaseOption[]);

    expect(graded).toBe(true);
    expect(options.map((entry) => entry.scoreMilli)).toEqual([1000, 600, 300, 0]);
  });

  it("maps a tier onto the palette the reader already draws", () => {
    // Three colours, not four: the design pass being preserved paints best /
    // viable / weak, and a graded option reuses it rather than inventing one.
    expect(outcomeForTier(1000)).toBe("best");
    expect(outcomeForTier(600)).toBe("viable");
    expect(outcomeForTier(300)).toBe("viable");
    expect(outcomeForTier(0)).toBe("weak");
  });
});

describe("the outcome shape", () => {
  it("reads best / viable / weak", () => {
    const { options, graded } = normalizeMiniCaseOptions([
      option({ id: "a", outcome: "best" }),
      option({ id: "b", outcome: "viable" }),
      option({ id: "c", outcome: "weak" })
    ]);

    expect(graded).toBe(false);
    expect(options.map((entry) => entry.scoreMilli)).toEqual([1000, 600, 0]);
  });
});

describe("the binary shape", () => {
  it("reads is_correct without crashing", () => {
    const { options, graded } = normalizeMiniCaseOptions([
      option({ id: "a", outcome: undefined, is_correct: true }),
      option({ id: "b", outcome: undefined, is_correct: false }),
      option({ id: "c", outcome: undefined, is_correct: false }),
      option({ id: "d", outcome: undefined, is_correct: false })
    ] as MiniCaseOption[]);

    expect(graded).toBe(false);
    expect(options.map((entry) => entry.scoreMilli)).toEqual([1000, 0, 0, 0]);
  });

  it("does not invent a middle tier for a wrong binary answer", () => {
    // is_correct: false says nothing about whether an answer was nearly right.
    // Mapping it to 300 or 600 would fabricate an editorial judgement.
    const { option: normalized } = normalizeMiniCaseOption(
      option({ outcome: undefined, is_correct: false }) as MiniCaseOption,
      0
    );

    expect(normalized.scoreMilli).toBe(0);
  });
});

describe("malformed and missing data", () => {
  it("survives an option with nothing on it", () => {
    const { options } = normalizeMiniCaseOptions([{} as MiniCaseOption]);

    expect(options[0]).toMatchObject({ id: "option-1", label: "", scoreMilli: 0 });
  });

  it("survives null and undefined option lists", () => {
    expect(normalizeMiniCaseOptions(null).options).toEqual([]);
    expect(normalizeMiniCaseOptions(undefined).graded).toBe(false);
  });

  it("ignores an off-scale score rather than trusting it", () => {
    // 750 is not a tier. Falling back to the outcome is the honest reading.
    const { option: normalized } = normalizeMiniCaseOption(
      option({ score_milli: 750, outcome: "viable" }) as MiniCaseOption,
      0
    );

    expect(normalized.scoreMilli).toBe(600);
  });
});

describe("which cases the server scores", () => {
  const graded = {
    options: [
      option({ id: "a", score_milli: 1000 }),
      option({ id: "b", score_milli: 600 }),
      option({ id: "c", score_milli: 300 }),
      option({ id: "d", score_milli: 0 })
    ] as MiniCaseOption[]
  };

  const legacy = {
    options: [
      option({ id: "a", outcome: "best" }),
      option({ id: "b", outcome: "weak" })
    ]
  };

  it("scores a graded case that has logical questions", () => {
    expect(
      isServerScorableMiniCase({ hasLogicalQuestions: true, questions: [graded, graded, graded] })
    ).toBe(true);
  });

  it("leaves a legacy case on its existing self-marked behaviour", () => {
    // The server grades from private.logical_question_grades, and a legacy case
    // has no rows there. Pushing it through the RPC would just fail.
    expect(
      isServerScorableMiniCase({ hasLogicalQuestions: true, questions: [graded, legacy, graded] })
    ).toBe(false);
  });

  it("leaves a case with no logical questions alone", () => {
    expect(
      isServerScorableMiniCase({ hasLogicalQuestions: false, questions: [graded, graded, graded] })
    ).toBe(false);
  });

  it("treats a case with no questions as not scorable", () => {
    expect(isServerScorableMiniCase({ hasLogicalQuestions: true, questions: [] })).toBe(false);
  });
});
