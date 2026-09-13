import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M7/M8. Progress comes back from the server, whatever the date, the language
 * or the device — including after the app was killed and reopened.
 */

type Row = Record<string, unknown>;

let serverRows: Row[] = [];
const queries: Array<{ table: string; columns: string; ids: string[] }> = [];

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        in: (_column: string, ids: string[]) => {
          queries.push({ table, columns, ids });
          return Promise.resolve({
            data: serverRows.filter((row) => ids.includes(row.logical_question_id as string)),
            error: null
          });
        }
      })
    })
  }
}));

import { summarizeContentProgress } from "./questionProgress";
import { fetchQuestionAttempts, mapAttemptRow } from "./questionProgressData";
import {
  knownAttempt,
  resetQuestionProgress,
  setQuestionProgressOwner
} from "./questionProgressStore";

const NOW = Date.parse("2026-09-20T10:00:00Z");

function currentRecords(ids: string[]) {
  return new Map(ids.map((id) => [id, knownAttempt(id) ?? null]));
}

beforeEach(() => {
  queries.length = 0;
  resetQuestionProgress();
  setQuestionProgressOwner("reader-1");
  // A reading from an edition three weeks ago: Q1 answered, Q2 timed out, Q3 never opened.
  serverRows = [
    {
      logical_question_id: "q1",
      status: "submitted",
      deadline_at: "2026-08-31T17:10:20Z",
      submitted_at: "2026-08-31T17:10:08Z",
      selected_option_id: "q1-a",
      score_milli: 1000
    },
    {
      logical_question_id: "q2",
      status: "submitted",
      deadline_at: "2026-08-31T17:12:20Z",
      submitted_at: "2026-08-31T17:12:25Z",
      selected_option_id: null,
      score_milli: 0
    }
  ];
});

describe("reading the reader's own attempts", () => {
  it("asks question_attempts by logical id only — no date, no language, no content row", async () => {
    await fetchQuestionAttempts(["q1", "q2", "q3"]);

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe("question_attempts");
    expect(queries[0].ids.sort()).toEqual(["q1", "q2", "q3"]);
    expect(queries[0].columns).not.toMatch(/edition_date|language|option_order|grade|rationale/);
  });

  it("7. an old edition keeps the state the server holds for it", async () => {
    await fetchQuestionAttempts(["q1", "q2", "q3"]);

    const progress = summarizeContentProgress(["q1", "q2", "q3"], currentRecords(["q1", "q2", "q3"]), NOW);

    expect(progress.states).toEqual(["answered", "timed_out", "unanswered"]);
    expect(progress).toMatchObject({ settled: 2, total: 3, status: "partial" });
  });

  it("8. a restart loses nothing: an empty store is refilled from the server", async () => {
    await fetchQuestionAttempts(["q1", "q2", "q3"]);
    const before = summarizeContentProgress(["q1", "q2", "q3"], currentRecords(["q1", "q2", "q3"]), NOW);

    // The app is killed: nothing survives in memory.
    resetQuestionProgress();
    setQuestionProgressOwner("reader-1");
    expect(knownAttempt("q1")).toBeUndefined();

    await fetchQuestionAttempts(["q1", "q2", "q3"]);
    const after = summarizeContentProgress(["q1", "q2", "q3"], currentRecords(["q1", "q2", "q3"]), NOW);

    expect(after).toEqual(before);
  });

  it("maps a late submit to an expired attempt and never reads a score on an open one", () => {
    expect(mapAttemptRow(serverRows[1])).toMatchObject({ expired: true, scoreMilli: 0 });
    expect(
      mapAttemptRow({
        logical_question_id: "q3",
        status: "in_progress",
        deadline_at: "2026-09-20T10:00:15Z",
        submitted_at: null,
        selected_option_id: null,
        score_milli: 1000
      })
    ).toMatchObject({ status: "in_progress", scoreMilli: null, expired: false });
  });
});
