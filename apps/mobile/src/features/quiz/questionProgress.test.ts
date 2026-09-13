import { beforeEach, describe, expect, it } from "vitest";

import type { DailyDropContentItem } from "../today/contentTypes";
import { questionIdsOf } from "./itemQuestions";
import {
  resolveQuestionState,
  resolveQuestionsCta,
  settledSeeds,
  summarizeContentProgress,
  type AttemptRecord
} from "./questionProgress";
import {
  knownAttempt,
  recordAttempt,
  resetQuestionProgress,
  setQuestionProgressOwner,
  storeAttempts
} from "./questionProgressStore";
import { contentQuestionsLabel, getQuizCopy, questionsCtaLabel } from "./quizCopy";

/**
 * A reading's question progress, as the server's attempts make it — before the
 * quiz is ever opened.
 */

const NOW = Date.parse("2026-09-20T10:00:00Z");

function submitted(id: string, overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    logicalQuestionId: id,
    status: "submitted",
    deadlineAt: "2026-09-14T17:10:20Z",
    expired: false,
    selectedOptionId: `${id}-b`,
    scoreMilli: 600,
    ...overrides
  };
}

function records(entries: Array<[string, AttemptRecord | null]>) {
  return new Map(entries);
}

const Q = ["q1", "q2"];

describe("M1–M3. the button says where the reader stands", () => {
  it("1. 0/2 → Go to questions", () => {
    const progress = summarizeContentProgress(Q, records([["q1", null], ["q2", null]]), NOW);

    expect(progress).toMatchObject({ total: 2, settled: 0, status: "not_started" });
    expect(questionsCtaLabel(resolveQuestionsCta(progress), getQuizCopy("en"))).toBe("Go to questions");
    expect(questionsCtaLabel(resolveQuestionsCta(progress), getQuizCopy("fr"))).toBe("Passer aux questions");
    expect(contentQuestionsLabel(progress, "fr")).toBe("Questions · 0/2");
  });

  it("2. 1/2 → Continue questions", () => {
    const progress = summarizeContentProgress(Q, records([["q1", submitted("q1")], ["q2", null]]), NOW);

    expect(progress).toMatchObject({ settled: 1, remaining: 1, status: "partial" });
    expect(questionsCtaLabel(resolveQuestionsCta(progress), getQuizCopy("en"))).toBe("Continue questions");
    expect(questionsCtaLabel(resolveQuestionsCta(progress), getQuizCopy("fr"))).toBe("Continuer les questions");
    expect(contentQuestionsLabel(progress, "en")).toBe("Questions · 1/2");
  });

  it("3. 2/2 → Questions completed", () => {
    const progress = summarizeContentProgress(
      Q,
      records([["q1", submitted("q1")], ["q2", submitted("q2")]]),
      NOW
    );

    expect(progress.status).toBe("completed");
    expect(questionsCtaLabel(resolveQuestionsCta(progress), getQuizCopy("en"))).toBe("Questions completed");
    expect(questionsCtaLabel(resolveQuestionsCta(progress), getQuizCopy("fr"))).toBe("Questions terminées");
    expect(contentQuestionsLabel(progress, "fr")).toBe("Questions · 2/2 terminées");
  });

  it("an open question already started counts as begun, not as done", () => {
    const open: AttemptRecord = {
      ...submitted("q1"),
      status: "in_progress",
      deadlineAt: "2026-09-20T10:00:15Z",
      selectedOptionId: null,
      scoreMilli: null
    };
    const progress = summarizeContentProgress(Q, records([["q1", open], ["q2", null]]), NOW);

    expect(progress.states).toEqual(["in_progress", "unanswered"]);
    expect(progress).toMatchObject({ settled: 0, status: "partial" });
  });

  it("shows nothing rather than a guess until the server has answered", () => {
    expect(contentQuestionsLabel(undefined, "en")).toBeNull();
  });
});

describe("M10. a timeout is settled, worth zero, and not replayable", () => {
  it("reads a late submit as timed out", () => {
    const late = submitted("q1", { expired: true, selectedOptionId: null, scoreMilli: 0 });

    expect(resolveQuestionState(late, NOW)).toBe("timed_out");
    expect(summarizeContentProgress(["q1"], records([["q1", late]]), NOW).status).toBe("completed");
    expect(settledSeeds(["q1"], records([["q1", late]]))).toEqual({
      q1: { scoreMilli: 0, expired: true, skipped: false, selectedOptionId: null }
    });
  });

  it("reads an open attempt past its deadline as timed out, and leaves it to the server to settle", () => {
    const abandoned: AttemptRecord = {
      ...submitted("q1"),
      status: "in_progress",
      deadlineAt: "2026-09-14T17:10:20Z",
      selectedOptionId: null,
      scoreMilli: null
    };

    expect(resolveQuestionState(abandoned, NOW)).toBe("timed_out");
    // Not seeded: opening it is what lets the server settle it at zero.
    expect(settledSeeds(["q1"], records([["q1", abandoned]]))).toEqual({});
  });

  it("tells a skip from a timeout", () => {
    const skipped = submitted("q1", { selectedOptionId: null, scoreMilli: 0 });

    expect(resolveQuestionState(skipped, NOW)).toBe("skipped");
    expect(settledSeeds(["q1"], records([["q1", skipped]])).q1.skipped).toBe(true);
  });
});

describe("M6/M9. one logical question, one progress", () => {
  it("6. the FR and EN renderings of one article show the same progress", () => {
    const logical = [
      { logical_question_id: "q1", question_sequence: 1, question_role: "interpretation" },
      { logical_question_id: "q2", question_sequence: 2, question_role: "application_decision" }
    ];
    const fr = { id: "row-fr", language: "fr", logical_questions: logical } as unknown as DailyDropContentItem;
    const en = { id: "row-en", language: "en", logical_questions: logical } as unknown as DailyDropContentItem;
    const attempts = records([["q1", submitted("q1")], ["q2", null]]);

    expect(questionIdsOf(fr)).toEqual(questionIdsOf(en));
    expect(summarizeContentProgress(questionIdsOf(fr), attempts, NOW)).toEqual(
      summarizeContentProgress(questionIdsOf(en), attempts, NOW)
    );
  });

  it("9. a question reached through a Team and Solo is one question with one state", () => {
    const progress = summarizeContentProgress(
      ["q1", "q1", "q2"],
      records([["q1", submitted("q1")], ["q2", null]]),
      NOW
    );

    expect(progress).toMatchObject({ total: 2, settled: 1 });
  });
});

describe("the session's store never contradicts the server", () => {
  beforeEach(() => {
    resetQuestionProgress();
    setQuestionProgressOwner("reader-1");
  });

  it("keeps a submitted attempt when a stale read says it was still open", () => {
    recordAttempt(submitted("q1"));
    storeAttempts(["q1"], [{ ...submitted("q1"), status: "in_progress", scoreMilli: null }]);

    expect(knownAttempt("q1")?.status).toBe("submitted");
  });

  it("keeps an attempt this session opened when a read that started earlier found none", () => {
    recordAttempt({ ...submitted("q1"), status: "in_progress", scoreMilli: null });
    storeAttempts(["q1"], []);

    expect(knownAttempt("q1")?.status).toBe("in_progress");
  });

  it("forgets everything when another reader signs in", () => {
    recordAttempt(submitted("q1"));
    setQuestionProgressOwner("reader-2");

    expect(knownAttempt("q1")).toBeUndefined();
  });
});
