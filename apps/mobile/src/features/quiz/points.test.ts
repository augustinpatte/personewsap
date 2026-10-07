import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getUserLocalDateKey } from "../../lib/localDate";
import { isTodayEdition } from "../today/editionRecency";
import { rankLeaderboard, formatTeamPoints, type LeaderboardMember } from "../teams/leaderboard";
import { buildAnswerExplanation } from "./answerExplanation";
import {
  earnedMilli,
  earnedPoints,
  formatPointsLong,
  formatPointsShort,
  fullCreditDate,
  GRADE_MILLI,
  isLateAnswer,
  pointsFromMilli
} from "./points";
import { getPointsRuleCopy } from "./pointsCopy";
import { formatPoints, questionReducer, summarizeQuiz, type QuestionState } from "./quizSession";

/**
 * The 100-point scale and the late-answer rule, on the client.
 *
 * The server is the authority (supabase/tests/late_answer_credit.test.sql
 * proves the rule where it is enforced); these pin the client's mirror of it
 * and every place a reader sees a number.
 */

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");

describe("the scale: 1 old point = 100 points", () => {
  it("normal credit: 0 / 0.3 / 0.6 / 1 → 0 / 30 / 60 / 100", () => {
    expect(GRADE_MILLI.map((grade) => earnedPoints(grade, false))).toEqual([0, 30, 60, 100]);
  });

  it("late credit: 0 / 30 / 60 / 100 → 0 / 15 / 30 / 50", () => {
    expect(GRADE_MILLI.map((grade) => earnedPoints(grade, true))).toEqual([0, 15, 30, 50]);
    expect(GRADE_MILLI.map((grade) => earnedMilli(grade, true))).toEqual([0, 150, 300, 500]);
  });

  it("the maximum late score is 50 points", () => {
    expect(Math.max(...GRADE_MILLI.map((grade) => earnedPoints(grade, true)))).toBe(50);
  });

  it("mirrors the server's own definition exactly", () => {
    const migration = readFileSync(
      join(repoRoot, "supabase", "migrations", "20261006120000_late_answer_credit.sql"),
      "utf8"
    );

    expect(migration).toContain("SELECT CASE WHEN p_late THEN p_score_milli / 2 ELSE p_score_milli END;");
    expect(migration).toMatch(/greatest\(\s*p_edition_date,\s*\(p_published_at AT TIME ZONE/);
    expect(migration).toContain("> public.full_credit_date(p_edition_date, p_published_at, p_timezone)");
  });

  it("converts once, in one place: no other module divides milli into points", () => {
    for (const file of [
      "features/quiz/answerExplanation.ts",
      "features/quiz/quizSession.ts",
      "features/teams/leaderboard.ts",
      "features/quiz/MiniCaseServerQuiz.tsx",
      "features/quiz/ReadingQuizScreen.tsx"
    ]) {
      const source = readFileSync(join(__dirname, "..", "..", file.replace(/^features\//, "features/")), "utf8");
      // A score divided or multiplied by hand, or rounded to a decimal.
      expect(source, file).not.toMatch(/[Mm]illi\s*\/\s*10{1,3}\b|[Mm]illi\s*\*\s*100\b|toFixed\(/);
    }
  });
});

describe("no decimal reaches a reader", () => {
  it("every reachable total is a whole number, grouped per language", () => {
    // Any mix of on-time and late answers over a long history.
    for (let milli = 0; milli <= 200_000; milli += 50) {
      expect(Number.isInteger(pointsFromMilli(milli))).toBe(true);
      expect(formatPoints(milli)).toMatch(/^\d{1,3}(,\d{3})*$/);
      expect(formatPoints(milli, "fr")).toMatch(/^\d{1,3}(\u202F\d{3})*$/);
    }
  });

  it("reads like the product: 1,430 pts · 760 pts · 50 pts", () => {
    expect(formatPointsShort(1430, "en")).toBe("1,430 pts");
    expect(formatPointsShort(760, "en")).toBe("760 pts");
    expect(formatPointsShort(50, "en")).toBe("50 pts");
    expect(formatTeamPoints(14_300)).toBe("1,430 pts");
    expect(formatPointsLong(100, "en")).toBe("100 points");
    expect(formatPointsLong(0, "fr")).toBe("0 point");
    expect(formatPointsLong(15, "fr")).toBe("15 points");
  });
});

describe("full credit through the reader's first local day with the edition", () => {
  // The Oct 6 edition publishes at 19:00 Paris = 17:00 UTC.
  const OCT_6 = "2026-10-06";
  const PUBLISHED = new Date("2026-10-06T17:00:00Z");
  const late = (timeZone: string, answeredAt: string, editionDate = OCT_6, publishedAt: Date | null = PUBLISHED) =>
    isLateAnswer({ editionDate, publishedAt, timeZone, answeredAt: new Date(answeredAt) });

  it("Paris: answered Oct 6 → full; Oct 7 → half", () => {
    expect(late("Europe/Paris", "2026-10-06T21:30:00Z")).toBe(false); // 23:30 Paris
    expect(late("Europe/Paris", "2026-10-07T06:00:00Z")).toBe(true); // 08:00 Paris
  });

  it("Chicago: available Oct 6 at noon; Oct 6 late evening → full; Oct 7 → half", () => {
    expect(late("America/Chicago", "2026-10-07T04:30:00Z")).toBe(false); // Oct 6 23:30 Chicago
    expect(late("America/Chicago", "2026-10-07T13:00:00Z")).toBe(true); // Oct 7 08:00 Chicago
  });

  it("east of Paris: first available Oct 7 local → Oct 7 is the full-credit day", () => {
    expect(fullCreditDate({ editionDate: OCT_6, publishedAt: PUBLISHED, timeZone: "Asia/Tokyo" })).toBe("2026-10-07");
    expect(late("Asia/Tokyo", "2026-10-07T14:30:00Z")).toBe(false); // Oct 7 23:30 Tokyo
    expect(late("Asia/Tokyo", "2026-10-07T23:00:00Z")).toBe(true); // Oct 8 08:00 Tokyo
  });

  it("an old Sep 18 edition opened on Oct 6 is late, and opening it cannot reset that", () => {
    const sept18 = new Date("2026-09-18T17:00:00Z");
    expect(late("Europe/Paris", "2026-10-06T08:00:00Z", "2026-09-18", sept18)).toBe(true);
    expect(late("Asia/Tokyo", "2026-10-06T08:00:00Z", "2026-09-18", sept18)).toBe(true);
    // Opening it again changes no input: the same instant gives the same answer.
    expect(late("Europe/Paris", "2026-10-06T08:00:00Z", "2026-09-18", sept18)).toBe(true);
  });

  it("is never cached: the answer instant decides", () => {
    expect(late("Europe/Paris", "2026-10-06T21:59:00Z")).toBe(false); // 23:59 Paris
    expect(late("Europe/Paris", "2026-10-06T22:01:00Z")).toBe(true); // 00:01 Paris
  });

  it("without a publication instant, falls back to the edition date", () => {
    expect(late("Asia/Tokyo", "2026-10-07T03:00:00Z", OCT_6, null)).toBe(true);
  });

  it("Today is still only edition_date == the reader's local date", () => {
    // Tokyo, Oct 7 12:00: inside the Oct 6 edition's full-credit day, and yet
    // not "Today" — the two concepts stay separate.
    const readerToday = getUserLocalDateKey(new Date("2026-10-07T03:00:00Z"), "Asia/Tokyo");
    expect(late("Asia/Tokyo", "2026-10-07T03:00:00Z")).toBe(false);
    expect(isTodayEdition(OCT_6, readerToday)).toBe(false);
    expect(isTodayEdition("2026-10-07", readerToday)).toBe(true);
  });
});

describe("what the quiz shows", () => {
  const options = [
    { optionId: "a", label: "A" },
    { optionId: "b", label: "B" }
  ];
  const submitting: QuestionState = {
    status: "submitting",
    attemptId: "t",
    deadlineAt: "2026-10-07T10:00:20Z",
    prompt: "Q",
    options,
    selectedOptionId: "b"
  };

  it("keeps the grade and the server's late flag, and totals what was earned", () => {
    const late = questionReducer(submitting, {
      type: "submit_succeeded",
      result: {
        attemptId: "t",
        scoreMilli: 1000,
        gradeBand: "excellent",
        expired: false,
        skipped: false,
        selectedOptionId: "b",
        late: true
      }
    });
    const onTime = questionReducer(submitting, {
      type: "submit_succeeded",
      result: {
        attemptId: "t",
        scoreMilli: 600,
        gradeBand: "good",
        expired: false,
        skipped: false,
        selectedOptionId: "b"
      }
    });

    expect(late).toMatchObject({ status: "answered", scoreMilli: 1000, gradeBand: "excellent", late: true });
    expect(onTime).toMatchObject({ status: "answered", late: false });
    // 50 + 60 = 110 points.
    expect(summarizeQuiz([late, onTime]).scoreMilli).toBe(1100);
    expect(formatPoints(summarizeQuiz([late, onTime]).scoreMilli)).toBe("110");
  });

  it("a historical answer (no late flag) keeps its full value", () => {
    const historical: QuestionState = {
      status: "answered",
      attemptId: "h",
      prompt: "Q",
      options,
      selectedOptionId: "a",
      scoreMilli: 1000,
      gradeBand: "excellent",
      expired: false,
      skipped: false
    };

    expect(summarizeQuiz([historical]).scoreMilli).toBe(1000);
  });

  it("the debrief shows what was earned and says why, in both languages", () => {
    for (const language of ["en", "fr"] as const) {
      const view = buildAnswerExplanation({
        language,
        outcome: "answered",
        scoreMilli: 600,
        late: true,
        selectedOptionId: "b",
        options,
        explanation: {
          outcome: "answered",
          selected: { optionId: "b", label: "B", scoreMilli: 600, feedback: "Why B." },
          best: { optionId: "a", label: "A", scoreMilli: 1000, feedback: "Why A." }
        }
      });

      expect(view.blocks[0].points).toBe("30 points");
      // The best answer is described at its normal value; the note explains.
      expect(view.blocks[1].points).toBe("100 points");
      expect(view.lateNote).toMatch(language === "fr" ? /50 %/ : /50%/);
    }
  });

  it("an on-time answer carries no late note", () => {
    const view = buildAnswerExplanation({
      language: "en",
      outcome: "answered",
      scoreMilli: 1000,
      selectedOptionId: "a",
      options,
      explanation: undefined
    });

    expect(view.blocks[0].points).toBe("100 points");
    expect(view.lateNote).toBeNull();
  });
});

describe("Teams: the unit changes, the order does not", () => {
  const member = (userId: string, scoreMilli: number): LeaderboardMember => ({
    userId,
    username: userId,
    countryCode: null,
    avatarPath: null,
    scoreMilli,
    answeredCount: 1,
    assignedCount: 1,
    editionsCompleted: 0,
    status: "completed"
  });

  it("ranks identically on milli and on points, ties included", () => {
    const members = [member("a", 14_300), member("b", 7_600), member("c", 7_600), member("d", 500)];
    const byMilli = rankLeaderboard({ members, selfUserId: "a" });
    const byPoints = rankLeaderboard({
      members: members.map((entry) => ({ ...entry, scoreMilli: pointsFromMilli(entry.scoreMilli) })),
      selfUserId: "a"
    });

    expect(byMilli.map((row) => [row.userId, row.rank])).toEqual(byPoints.map((row) => [row.userId, row.rank]));
    expect(byMilli.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
    expect(byMilli.map((row) => formatTeamPoints(row.scoreMilli))).toEqual([
      "1,430 pts",
      "760 pts",
      "760 pts",
      "50 pts"
    ]);
  });
});

describe("the client cannot claim a score or a lateness", () => {
  it("sends an attempt id and an option id, nothing else", () => {
    const quizData = readFileSync(join(__dirname, "quizData.ts"), "utf8");
    const call = /\.rpc\("submit_question_answer", \{([\s\S]*?)\}\)/.exec(quizData)?.[1] ?? "";

    expect(call.match(/p_[a-z_]+/g)).toEqual(["p_attempt_id", "p_selected_option_id"]);
  });
});

describe("the rule, explained the same way everywhere", () => {
  it("says it in both languages, with the new scale", () => {
    expect(getPointsRuleCopy("en").lateRule).toBe(
      "Answer on the edition day to earn full points. You can still answer older editions, but late answers earn 50% of the normal points."
    );
    expect(getPointsRuleCopy("fr").lateRule).toMatch(/jour de l'édition.*50 % des points habituels/);
    expect(getPointsRuleCopy("en").scale).toMatch(/0 points, 30 points, 60 points or 100 points/);
    expect(getPointsRuleCopy("fr").scale).toMatch(/0 point, 30 points, 60 points ou 100 points/);
  });

  it("is on Settings, the Teams introduction and the scoring page", () => {
    const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

    expect(read("settings/SettingsScreen.tsx")).toContain(".lateRule");
    expect(read("teams/teamsIntroCopy.ts")).toContain("late: rule.lateRule");
    expect(read("teams/TeamsIntro.tsx")).toContain("{copy.points.late}");
    expect(read("teams/helpCopy.ts").match(/rule\.lateRule/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
