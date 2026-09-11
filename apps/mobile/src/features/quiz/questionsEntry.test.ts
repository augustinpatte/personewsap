import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { DailyDropContentItem } from "../today/contentTypes";
import { goToQuestionsAfterReading, readItemQuestions, resolveReadingCta } from "./itemQuestions";
import { getQuizCopy } from "./quizCopy";

/**
 * From the end of a reading to its questions, and every screen in between.
 *
 * The decisions are pure and tested directly; which component renders which
 * state is pinned by reading the source, in the idiom this repository uses for
 * React Native screens (see quizFlowContract.test.ts).
 */

const featuresDir = join(__dirname, "..");
const mobileSrc = join(featuresDir, "..");
const read = (...segments: string[]) => readFileSync(join(featuresDir, ...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const questionCard = stripComments(read("quiz", "QuestionCard.tsx"));
const readingQuizScreen = stripComments(read("quiz", "ReadingQuizScreen.tsx"));
const miniCaseQuiz = stripComments(read("quiz", "MiniCaseServerQuiz.tsx"));
const scaffold = stripComments(read("today", "readers", "ReaderScaffold.tsx"));

function scoredNewsletter(overrides: Record<string, unknown> = {}): DailyDropContentItem {
  return {
    id: "article-fr",
    content_type: "newsletter_article",
    content_logical_key: "job-42",
    logical_questions: [
      { logical_question_id: "lq-interpretation", question_sequence: 1, question_role: "interpretation" },
      { logical_question_id: "lq-application", question_sequence: 2, question_role: "application_decision" }
    ],
    ...overrides
  } as unknown as DailyDropContentItem;
}

describe("A/B. the end-of-reading button is decided by the data", () => {
  it("A. a scored Newsletter with its two questions leads to them", () => {
    const { questions } = readItemQuestions(scoredNewsletter());

    expect(questions).toHaveLength(2);
    expect(resolveReadingCta({ questionCount: questions.length, completed: false })).toBe("go_to_questions");
    // Already read: still its questions (the server says what is left), never a dead end.
    expect(resolveReadingCta({ questionCount: questions.length, completed: true })).toBe("go_to_questions");
    expect(getQuizCopy("fr").goToQuestions).toBe("Passer aux questions");
    expect(getQuizCopy("en").goToQuestions).toBe("Go to questions");
  });

  it("B. a legacy Newsletter with no questions keeps Mark as read / Back", () => {
    const legacy = scoredNewsletter({ logical_questions: undefined });

    expect(readItemQuestions(legacy).questions).toEqual([]);
    expect(resolveReadingCta({ questionCount: 0, completed: false })).toBe("mark_read");
    expect(resolveReadingCta({ questionCount: 0, completed: true })).toBe("back");
  });
});

describe("C. pressing Go to questions", () => {
  it("starts the canonical read write first, and opens the questions without waiting for it", async () => {
    const order: string[] = [];
    let finishWrite!: () => void;
    const markRead = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push("markRead");
          finishWrite = resolve;
        })
    );
    const openQuestions = vi.fn(() => order.push("openQuestions"));

    const done = goToQuestionsAfterReading({ completed: false, markRead, openQuestions });

    // Navigation happened while the write is still in flight...
    expect(order).toEqual(["markRead", "openQuestions"]);
    // ...and the write is not lost: it is the one call, and it completes.
    finishWrite();
    await done;
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it("does not write again for a reading already read, and reports a failed write", async () => {
    const markRead = vi.fn(() => Promise.reject(new Error("offline")));
    const onMarkReadError = vi.fn();
    const openQuestions = vi.fn();

    await goToQuestionsAfterReading({ completed: true, markRead, openQuestions });
    expect(markRead).not.toHaveBeenCalled();
    expect(openQuestions).toHaveBeenCalledTimes(1);

    await goToQuestionsAfterReading({ completed: false, markRead, openQuestions, onMarkReadError });
    expect(onMarkReadError).toHaveBeenCalledTimes(1);
    expect(openQuestions).toHaveBeenCalledTimes(2);
  });
});

describe("D. the questions are this content's own", () => {
  it("takes exactly the item's logical questions, in answering order, whatever the row order", () => {
    const item = scoredNewsletter({
      logical_questions: [
        { logical_question_id: "lq-application", question_sequence: 2, question_role: "application_decision" },
        { logical_question_id: "lq-interpretation", question_sequence: 1, question_role: "interpretation" },
        { question_sequence: 3 },
        null
      ]
    });

    expect(readItemQuestions(item).questions.map((question) => question.logicalQuestionId)).toEqual([
      "lq-interpretation",
      "lq-application"
    ]);
  });

  it("gives a Mini Case its three questions in the method → application → conclusion order", () => {
    const item = scoredNewsletter({
      content_type: "mini_case",
      logical_questions: [
        { logical_question_id: "c3", question_sequence: 3, question_role: "conclusion_decision" },
        { logical_question_id: "c1", question_sequence: 1, question_role: "method_framework" },
        { logical_question_id: "c2", question_sequence: 2, question_role: "technical_application" }
      ]
    });

    expect(readItemQuestions(item).questions.map((question) => question.logicalQuestionId)).toEqual([
      "c1",
      "c2",
      "c3"
    ]);
  });

  it("reads them from the item the reader opened, not from the edition", () => {
    const dailyDropData = readFileSync(join(featuresDir, "today", "dailyDropData.ts"), "utf8");

    expect(dailyDropData).toContain("logical_questions: questionsByContentItemId[contentItem.id]");
    expect(dailyDropData).toContain('.in("content_logical_key"');
  });
});

describe("E/F/G. no question screen is ever empty", () => {
  it("E. LOADING is a question-shaped skeleton with a label, not a bare caption", () => {
    const loading = questionCard.slice(
      questionCard.indexOf('if (state.status === "idle" || state.status === "starting")'),
      questionCard.indexOf("const seconds = remainingSeconds")
    );

    expect(loading).toContain("<SkeletonLine");
    expect(loading).toContain("<SkeletonBlock");
    expect(loading).toContain("copy.loadingQuestion");
    expect(loading).not.toContain("return null");
  });

  it("F. ERROR says Questions unavailable, with Retry and a way back to the reading", () => {
    const failed = questionCard.slice(
      questionCard.indexOf('if (state.status === "start_failed")'),
      questionCard.indexOf('if (state.status === "idle"')
    );

    expect(failed).toContain("copy.startFailedTitle");
    expect(failed).toContain("onPress={onRetryStart}");
    expect(failed).toContain("copy.backToContent");
    expect(getQuizCopy("en").startFailedTitle).toBe("Questions unavailable");
    expect(getQuizCopy("fr").startFailedTitle).toBe("Questions indisponibles");
  });

  it("G. EMPTY is stated explicitly on both question hosts", () => {
    expect(readingQuizScreen).toContain("if (questions.length === 0)");
    expect(readingQuizScreen).toContain("title={copy.emptyTitle}");
    expect(miniCaseQuiz).toContain("questions.length === 0 ? (");
    expect(miniCaseQuiz).toContain("title={copy.emptyTitle}");

    for (const language of ["fr", "en"] as const) {
      const copy = getQuizCopy(language);

      for (const text of [copy.emptyTitle, copy.emptyBody, copy.loadingQuestion, copy.backToContent]) {
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("never returns null from a question host", () => {
    for (const source of [readingQuizScreen, miniCaseQuiz, questionCard]) {
      expect(source).not.toMatch(/return null;/);
    }
  });
});

describe("H. the surface stays the reader's own, light or dark", () => {
  const theme = readFileSync(join(mobileSrc, "design", "theme.ts"), "utf8");
  const dark = theme.slice(theme.indexOf("export const darkColors"), theme.indexOf("const palettes"));
  const hex = (token: string) => {
    const match = new RegExp(`\\b${token}: "(#[0-9A-Fa-f]{6})"`).exec(dark);
    if (!match) throw new Error(`no ${token} in darkColors`);
    return match[1];
  };
  const luminance = (value: string) => {
    const channel = (offset: number) => {
      const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };

  it("paints dark text-on-dark nowhere: ink is light on the espresso background", () => {
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    expect(luminance(hex("background"))).toBeLessThan(0.05);
    expect(contrast(hex("ink"), hex("background"))).toBeGreaterThan(7);
    expect(contrast(hex("ink"), hex("surface"))).toBeGreaterThan(7);
  });

  it("uses only theme tokens on every question surface — no white, no black, no hex", () => {
    for (const source of [questionCard, readingQuizScreen, miniCaseQuiz, scaffold]) {
      expect(source).toMatch(/useThemedStyles|useThemeColors/);
      expect(source).not.toMatch(/#[0-9a-f]{3,6}\b/i);
      expect(source).not.toMatch(/colors\.(white|black)|"white"|"black"/);
    }
  });

  it("keeps the reader's background under every state and transition", () => {
    expect(scaffold).toMatch(/safeArea: \{[\s\S]{0,80}backgroundColor: c\.background/);

    const layout = readFileSync(join(mobileSrc, "..", "app", "(reader)", "_layout.tsx"), "utf8");
    expect(layout).toContain("contentStyle: { backgroundColor: colors.background }");

    // Every question state is rendered inside the same scaffold.
    expect(readingQuizScreen.match(/<ReaderScaffold/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
