import { describe, expect, it } from "vitest";

import type { MiniCaseResponseMap } from "./miniCaseResponses";
import {
  formatAnswerMarkdown,
  mergeMiniCaseResponses,
  toResponseRecord,
  toResponseRow
} from "./miniCaseMapping";

const localRecord = {
  selections: { q1: "b", q2: "a" },
  score: 1,
  total: 2,
  completedAt: "2026-08-10T09:00:00.000Z"
};

describe("merging device and server results", () => {
  it("keeps the server copy when both sides know a case", () => {
    const local: MiniCaseResponseMap = { "case-1": localRecord };
    const remote: MiniCaseResponseMap = {
      "case-1": { ...localRecord, score: 2, completedAt: "2026-08-09T09:00:00.000Z" }
    };

    const { merged, localOnly } = mergeMiniCaseResponses(local, remote);

    expect(merged["case-1"].score).toBe(2);
    expect(localOnly).toEqual([]);
  });

  it("surfaces device-only results so they can be pushed up", () => {
    const local: MiniCaseResponseMap = { "case-1": localRecord, "case-2": localRecord };
    const remote: MiniCaseResponseMap = { "case-1": localRecord };

    const { merged, localOnly } = mergeMiniCaseResponses(local, remote);

    expect(localOnly).toEqual(["case-2"]);
    expect(Object.keys(merged).sort()).toEqual(["case-1", "case-2"]);
  });

  it("adopts results solved on another device", () => {
    const { merged } = mergeMiniCaseResponses({}, { "case-9": localRecord });

    expect(merged["case-9"]).toEqual(localRecord);
  });
});

describe("row mapping", () => {
  it("stores the score as the 0-1 ratio the column allows", () => {
    const row = toResponseRow("user-1", "case-1", localRecord);

    expect(row.score).toBe(0.5);
    expect(row.score_max).toBe(2);
    expect(row.selections).toEqual({ q1: "b", q2: "a" });
    expect(row.user_id).toBe("user-1");
    expect(row.content_item_id).toBe("case-1");
  });

  it("never writes a blank answer_md, which the table forbids", () => {
    expect(toResponseRow("u", "c", localRecord).answer_md.length).toBeGreaterThan(0);
    expect(
      toResponseRow("u", "c", { ...localRecord, selections: {} }).answer_md.length
    ).toBeGreaterThan(0);
    expect(formatAnswerMarkdown(localRecord)).toContain("q1: b");
  });

  it("round-trips a stored row back into points out of total", () => {
    const record = toResponseRecord({
      score: 0.5,
      score_max: 2,
      selections: { q1: "b", q2: "a" },
      completed_at: "2026-08-10T09:00:00.000Z"
    });

    expect(record).toEqual(localRecord);
  });

  it("tolerates a legacy row with no structured result", () => {
    const record = toResponseRecord({
      score: null,
      score_max: null,
      selections: null,
      completed_at: null,
      created_at: "2026-07-01T09:00:00.000Z"
    });

    expect(record).toEqual({
      selections: {},
      score: 0,
      total: 0,
      completedAt: "2026-07-01T09:00:00.000Z"
    });
  });

  it("drops non-string selections rather than trusting the payload", () => {
    const record = toResponseRecord({
      score: 1,
      score_max: 1,
      selections: { q1: "b", q2: 42, q3: null },
      completed_at: "2026-08-10T09:00:00.000Z"
    });

    expect(record.selections).toEqual({ q1: "b" });
  });
});
