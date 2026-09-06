import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ANALYTICS_EVENTS } from "../../lib/analytics";
import { itemHasQuestions, readItemQuestions } from "./itemQuestions";

/**
 * The screen-level rules, checked where they actually live.
 *
 * The reducer in `quizSession.ts` is tested directly; what cannot be tested
 * that way is *which screen renders what*, and those are the rules with the
 * most product weight:
 *
 *   the article is hidden while a Newsletter question is on screen;
 *   the case stays visible while a Mini Case question is on screen;
 *   a question never starts before its screen is visible;
 *   Parcours is not touched at all.
 *
 * Source assertions, in the idiom this repository already uses for React Native
 * components (see loadingStates.test.ts and sourceSurface.test.ts): the mobile
 * tree cannot be rendered under jsdom, so the wiring is pinned by reading it.
 */

const featuresDir = join(__dirname, "..");
const read = (...segments: string[]) => readFileSync(join(featuresDir, ...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const newsletterReader = stripComments(read("today", "readers", "NewsletterReader.tsx"));
const storyReader = stripComments(read("today", "readers", "BusinessStoryReader.tsx"));
const miniCaseReader = stripComments(read("today", "readers", "MiniCaseReader.tsx"));
const readingQuizScreen = stripComments(read("quiz", "ReadingQuizScreen.tsx"));
const miniCaseQuiz = stripComments(read("quiz", "MiniCaseServerQuiz.tsx"));
const questionCard = stripComments(read("quiz", "QuestionCard.tsx"));
const flow = stripComments(read("quiz", "useQuizFlow.ts"));
const data = stripComments(read("quiz", "quizData.ts"));

describe("the Newsletter flow", () => {
  it("marks the article read before anything else happens", () => {
    // The existing completion semantics are unchanged: the article is read the
    // moment the reader says so, whatever the questions do afterwards.
    const finish = newsletterReader.slice(newsletterReader.indexOf("const onFinish"));

    expect(finish.indexOf("markItemsComplete")).toBeLessThan(finish.indexOf("setShowQuiz"));
  });

  it("moves to the quiz only when there are unanswered questions", () => {
    expect(newsletterReader).toMatch(/questions\.length > 0 && quiz\.hasPending/);
  });

  it("hides the article once the quiz starts", () => {
    // An early return, not a section appended below the body: the reader
    // literally cannot see the text while answering.
    expect(newsletterReader).toMatch(/if \(showQuiz\) \{[\s\S]{0,400}return \(\s*<ReadingQuizScreen/);
  });

  it("renders no article body on the question screen", () => {
    // The headline stays as an anchor; nothing else does.
    for (const bodyField of ["body_md", "MarkdownBody", "why_it_matters", "summary"]) {
      expect(readingQuizScreen, bodyField).not.toContain(bodyField);
    }
  });

  it("closes back to the reader rather than replaying", () => {
    expect(newsletterReader).toContain("onClose={() => router.back()}");
  });
});

describe("the Business Story flow", () => {
  it("uses the same hidden-article flow as the Newsletter", () => {
    expect(storyReader).toMatch(/if \(showQuiz\) \{[\s\S]{0,400}<ReadingQuizScreen/);
    expect(storyReader).toMatch(/questions\.length > 0 && quiz\.hasPending/);
  });

  it("is Solo: no team badge and no team flag", () => {
    expect(storyReader).toContain("isTeam: false");
    expect(storyReader).toContain("teams={[]}");
  });

  it("leaves a story with no questions on its original behaviour", () => {
    // `readItemQuestions` returns an empty array for legacy content, so the
    // branch simply does not fire and the reader closes as it always did.
    expect(storyReader).toContain("readItemQuestions(item)");
  });
});

describe("the Mini Case flow", () => {
  it("keeps the case visible while questions are answered", () => {
    // The opposite decision to the Newsletter, and the one that matters most
    // here: a reader who cannot re-read the constraint is being tested on memory.
    expect(miniCaseQuiz).toContain("{caseIntro}");
    expect(miniCaseQuiz.indexOf("{caseIntro}")).toBeLessThan(
      miniCaseQuiz.indexOf("<QuestionCard")
    );
  });

  it("reuses ReaderScaffold and the existing CaseIntro", () => {
    expect(miniCaseQuiz).toContain("ReaderScaffold");
    expect(miniCaseReader).toContain("caseIntro={<CaseIntro challenge={item}");
  });

  it("is additive: legacy cases keep the existing flows", () => {
    // One predicate, one branch. Everything below it is the untouched reader.
    expect(miniCaseReader).toContain("isServerScorableMiniCase");
    expect(miniCaseReader).toContain("return <MiniCaseFlow challenge={item} key={item.id} />;");
  });

  it("still has its three original flows intact", () => {
    for (const flowName of ["MiniCaseQuizFlow", "MiniCaseReviewFlow", "MiniCaseLegacyFlow"]) {
      expect(miniCaseReader, flowName).toContain(`function ${flowName}`);
    }
  });

  it("keeps the three pedagogical roles routed in the reader", () => {
    // The progression is what the exercise is. It reaches the screen through
    // roleLabelFor, so that is what is pinned rather than the raw role strings.
    expect(miniCaseReader).toContain("function roleLabelFor(role: MiniCaseQuestionRole");

    for (const roleCopy of ["copy.roleMethod", "copy.roleApplication", "copy.roleConclusion"]) {
      expect(miniCaseReader, roleCopy).toContain(roleCopy);
    }
  });

  it("still declares the three roles in the content model", () => {
    const contentTypes = readFileSync(join(featuresDir, "today", "contentTypes.ts"), "utf8");

    expect(contentTypes).toContain('"method" | "application" | "conclusion"');
  });
});

describe("a question never starts before it is visible", () => {
  it("gates the start on an explicit active flag", () => {
    expect(flow).toContain("if (!input.active");
  });

  it("starts only the question the reader is on", () => {
    // summarizeQuiz points at the first unsettled question, and the effect fires
    // for that index alone — so Q2's twenty seconds cannot run behind Q1.
    expect(flow).toContain("startedRef.current.has(currentIndex)");
    expect(flow).toMatch(/startQuestionAttempt\(currentQuestion\.logicalQuestionId\)/);
  });

  it("passes active: false until the reader finishes the article", () => {
    expect(newsletterReader).toContain("active: showQuiz");
    expect(storyReader).toContain("active: showQuiz");
  });

  it("prefetches nothing", () => {
    for (const source of [flow, questionCard]) {
      expect(source).not.toMatch(/prefetch/i);
    }
  });
});

describe("the server owns the clock", () => {
  it("never falls back to a local timer when the start fails", () => {
    expect(flow).toContain('action: { type: "start_failed"');
    expect(questionCard).toContain("copy.startFailedTitle");
    expect(questionCard).toContain("onRetryStart");
  });

  it("sends no client timestamp in either RPC", () => {
    // The reason a late answer cannot be rescued by a client-side fix.
    expect(data).not.toMatch(/p_(client|now|submitted|answered)_?(at|time)/i);
    expect(data).not.toMatch(/Date\.now\(\)/);
  });

  it("ticks against the server deadline rather than counting down locally", () => {
    expect(flow).toMatch(/type: "tick", now: Date\.now\(\)/);
    expect(questionCard).toContain("remainingSeconds(state, now)");
  });

  it("gives no speed bonus", () => {
    for (const source of [flow, questionCard, data]) {
      expect(source).not.toMatch(/bonus|elapsed|speed/i);
    }
  });
});

describe("accessibility", () => {
  it("gives every option a role, a label and a state", () => {
    expect(questionCard).toContain('accessibilityRole="radio"');
    expect(questionCard).toContain("describeOptionForAccessibility");
    expect(questionCard).toMatch(/accessibilityState=\{\{ checked: selected, disabled: locked/);
    expect(questionCard).toContain('accessibilityRole="radiogroup"');
  });

  it("does not make the timer the only way to know time is short", () => {
    expect(questionCard).toContain("copy.timeRunningOut");
    expect(questionCard).toContain("accessibilityLiveRegion");
  });

  it("keeps the option target reachable and growable", () => {
    // Vertical padding plus a minimum, not a fixed height: the row grows with
    // Dynamic Type instead of clipping.
    expect(questionCard).toMatch(/minHeight: 52/);
    expect(questionCard).toMatch(/paddingVertical: tokens\.space\.md/);
    expect(questionCard).not.toMatch(/height: \d+,[\s\S]{0,80}option/);
  });

  it("respects Reduce Motion", () => {
    expect(questionCard).toContain("useReducedMotion");
    expect(questionCard).toContain("reduceMotion ? content :");
  });
});

describe("the design system is not duplicated", () => {
  it("builds every quiz surface from the existing components and tokens", () => {
    for (const [name, source] of [
      ["question card", questionCard],
      ["reading quiz", readingQuizScreen],
      ["mini case quiz", miniCaseQuiz]
    ] as const) {
      expect(source, name).toContain("tokens.space");
      expect(source, name).toMatch(/useThemedStyles|useThemeColors/);
      // No second palette, no gradients, no game furniture.
      expect(source, name).not.toMatch(/#[0-9a-f]{6}/i);
      expect(source, name).not.toMatch(/gradient|confetti|trophy|emoji/i);
    }
  });

  it("reuses ReaderScaffold rather than inventing a second scaffold", () => {
    expect(readingQuizScreen).toContain("ReaderScaffold");
    expect(miniCaseQuiz).toContain("ReaderScaffold");
  });
});

describe("analytics", () => {
  it("registers exactly the six events asked for", () => {
    for (const event of [
      "quiz_started",
      "quiz_answered",
      "quiz_timed_out",
      "quiz_skipped",
      "quiz_completed",
      "team_content_opened"
    ]) {
      expect(ANALYTICS_EVENTS, event).toContain(event);
    }
  });

  it("never logs a score, a grade or an option", () => {
    // The answer key is server-side; an analytics payload must not become the
    // way it leaks.
    const analytics = stripComments(read("..", "lib", "analytics.ts"));

    for (const forbidden of ["score_milli", "grade_band", "option_id", "rationale", "team_id"]) {
      expect(analytics, forbidden).not.toContain(forbidden);
    }

    expect(flow).not.toMatch(/trackAnalyticsEvent\([^)]*score/);
  });
});

describe("legacy content", () => {
  it("reports no questions for an item that predates them", () => {
    // Two months of approved Premium has no logical_questions field at all.
    expect(readItemQuestions(undefined as never)).toEqual({ questions: [], teams: [] });
    expect(readItemQuestions({} as never)).toEqual({ questions: [], teams: [] });
    expect(itemHasQuestions({ id: "x" } as never)).toBe(false);
  });

  it("survives a malformed question block", () => {
    for (const carrier of [
      { logical_questions: null },
      { logical_questions: "nope" },
      { logical_questions: [{}, { id: 12 }] },
      { teams: [{ name: "no id" }] }
    ]) {
      expect(() => readItemQuestions(carrier as never)).not.toThrow();
      expect(readItemQuestions(carrier as never).questions).toEqual([]);
    }
  });

  it("reads a well-formed block", () => {
    const result = readItemQuestions({
      logical_questions: [{ logical_question_id: "q1" }, { id: "q2" }],
      teams: [{ id: "t1", name: "Loyola Finance" }, { id: "t2", name: null }]
    } as never);

    expect(result.questions.map((entry) => entry.logicalQuestionId)).toEqual(["q1", "q2"]);
    expect(result.teams).toHaveLength(2);
    expect(result.teams[1].name).toBeNull();
  });
});

describe("Parcours is untouched", () => {
  it("has no quiz import anywhere in the learning feature", () => {
    const learningDir = join(featuresDir, "learning");
    const files = ["LearningSessionScreen.tsx", "LearningPathContext.tsx", "learningTypes.ts"];

    for (const file of files) {
      const source = readFileSync(join(learningDir, file), "utf8");

      expect(source, file).not.toMatch(/quiz\//);
      expect(source, file).not.toContain("useQuizFlow");
      expect(source, file).not.toContain("start_question_attempt");
    }
  });

  it("adds no team concept to the learning path", () => {
    const context = readFileSync(
      join(featuresDir, "learning", "LearningPathContext.tsx"),
      "utf8"
    );

    expect(context).not.toMatch(/\bteam_id\b|\bTeamRef\b/);
  });
});
