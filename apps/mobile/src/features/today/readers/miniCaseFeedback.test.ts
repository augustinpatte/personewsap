import { describe, expect, it } from "vitest";

import type { MiniCaseChallenge, MiniCaseQuestion } from "../contentTypes";
import {
  findBestOption,
  resolveOptionFeedback,
  scoreMiniCaseSelections
} from "./miniCaseFeedback";

const question: MiniCaseQuestion = {
  id: "q1",
  prompt: "Which call do you make?",
  explanation: "The question explanation.",
  options: [
    { id: "a", label: "Cut the price", outcome: "weak", feedback: "Why cutting price fails." },
    { id: "b", label: "Hold the line", outcome: "best", feedback: "Why holding the line wins." },
    { id: "c", label: "Wait a quarter", outcome: "weak", feedback: "" }
  ]
};

const challenge = {
  id: "case-1",
  content_type: "mini_case",
  expected_reasoning: ["Reasoning one"],
  final_takeaway: "The takeaway.",
  questions: [question]
} as unknown as MiniCaseChallenge;

const copy = { feedbackFallback: "Fallback explanation." };

function feedbackFor(optionId: string, selectedId: string | null, answered = true) {
  const option = question.options.find((candidate) => candidate.id === optionId)!;

  return resolveOptionFeedback({
    answered,
    challenge,
    copy,
    option,
    question,
    selectedId
  });
}

describe("feedback attached to the option cards", () => {
  it("shows nothing before an answer", () => {
    for (const option of question.options) {
      expect(feedbackFor(option.id, null, false)).toBeNull();
    }
  });

  it("marks the picked correct answer as correct, inside its own card", () => {
    const feedback = feedbackFor("b", "b");

    expect(feedback).toEqual({
      tone: "correct",
      labelKey: "correct",
      body: "Why holding the line wins."
    });
  });

  it("stays silent on the other cards when the answer was right", () => {
    expect(feedbackFor("a", "b")).toBeNull();
    expect(feedbackFor("c", "b")).toBeNull();
  });

  it("explains the mistake in the picked card and the truth in the correct card", () => {
    const picked = feedbackFor("a", "a");
    const correct = feedbackFor("b", "a");

    expect(picked).toEqual({
      tone: "incorrect",
      labelKey: "incorrect",
      body: "Why cutting price fails."
    });
    expect(correct).toEqual({
      tone: "reveal",
      labelKey: "correctAnswer",
      body: "Why holding the line wins."
    });
    // The reader sees both at once, and nothing on the untouched option.
    expect(feedbackFor("c", "a")).toBeNull();
  });

  it("falls back to the question explanation, then the takeaway, then a default", () => {
    const noFeedbackQuestion: MiniCaseQuestion = {
      ...question,
      options: question.options.map((option) => ({ ...option, feedback: "" }))
    };

    const best = resolveOptionFeedback({
      answered: true,
      challenge,
      copy,
      option: noFeedbackQuestion.options[1],
      question: noFeedbackQuestion,
      selectedId: noFeedbackQuestion.options[1].id
    });
    const wrong = resolveOptionFeedback({
      answered: true,
      challenge,
      copy,
      option: noFeedbackQuestion.options[0],
      question: noFeedbackQuestion,
      selectedId: noFeedbackQuestion.options[0].id
    });

    expect(best?.body).toBe("The question explanation.");
    // A wrong option has no generic stand-in to borrow, so it says so plainly.
    expect(wrong?.body).toBe("Fallback explanation.");
  });

  it("reveals the correct answer in review when no answer was ever stored", () => {
    const revealed = feedbackFor("b", null);

    expect(revealed?.labelKey).toBe("correctAnswer");
    expect(feedbackFor("a", null)).toBeNull();
  });

  it("exposes the correct option for the review header", () => {
    expect(findBestOption(question)?.id).toBe("b");
  });
});

describe("scoring", () => {
  const questions: MiniCaseQuestion[] = [
    question,
    { ...question, id: "q2" },
    { ...question, id: "q3" }
  ];

  it("gives one point per best answer", () => {
    expect(scoreMiniCaseSelections(questions, { q1: "b", q2: "a", q3: "b" })).toBe(2);
    expect(scoreMiniCaseSelections(questions, { q1: "b", q2: "b", q3: "b" })).toBe(3);
    expect(scoreMiniCaseSelections(questions, {})).toBe(0);
  });
});
