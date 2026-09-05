import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Haptics are feedback about a product action, never part of one.
 *
 * Two properties matter more than which pattern plays: the app touches you only
 * at the few moments something was decided, and a Taptic Engine that is
 * unavailable, busy, or absent can never stop an answer from being recorded.
 */

const notificationAsync = vi.fn();
const impactAsync = vi.fn();
const selectionAsync = vi.fn();

vi.mock("expo-haptics", () => ({
  notificationAsync: (...args: unknown[]) => notificationAsync(...args),
  impactAsync: (...args: unknown[]) => impactAsync(...args),
  selectionAsync: (...args: unknown[]) => selectionAsync(...args),
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error"
  },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" }
}));

const { answerCorrect, answerIncorrect, sessionCompleted } = await import("./haptics");

beforeEach(() => {
  notificationAsync.mockReset();
  notificationAsync.mockResolvedValue(undefined);
  impactAsync.mockReset();
  selectionAsync.mockReset();
});

describe("the three moments", () => {
  it("marks a correct answer with a restrained success", () => {
    answerCorrect();

    expect(notificationAsync).toHaveBeenCalledTimes(1);
    expect(notificationAsync).toHaveBeenCalledWith("success");
  });

  it("marks a wrong answer as a warning, never an error", () => {
    answerIncorrect();

    expect(notificationAsync).toHaveBeenCalledWith("warning");
    // Error is the harsh destructive pattern. A wrong answer in a learning
    // exercise is a normal move, not a failure.
    expect(notificationAsync).not.toHaveBeenCalledWith("error");
  });

  it("marks a finished session once", () => {
    sessionCompleted();

    expect(notificationAsync).toHaveBeenCalledTimes(1);
    expect(notificationAsync).toHaveBeenCalledWith("success");
  });

  it("never uses an impact or a bare selection tick", () => {
    answerCorrect();
    answerIncorrect();
    sessionCompleted();

    // Selection and outcome are the same event in both Mini Case flows, so a
    // separate tick would be a second buzz for one decision.
    expect(selectionAsync).not.toHaveBeenCalled();
    expect(impactAsync).not.toHaveBeenCalled();
  });
});

describe("a haptic can never break a product action", () => {
  it("swallows a rejected engine call", async () => {
    notificationAsync.mockRejectedValue(new Error("Haptic engine unavailable"));

    expect(() => answerCorrect()).not.toThrow();
    // Let the rejection settle: an unhandled rejection here would crash a
    // release build even though nothing product-facing failed.
    await Promise.resolve();
    await Promise.resolve();
  });

  it("swallows an engine that throws synchronously", () => {
    notificationAsync.mockImplementation(() => {
      throw new Error("No haptics on this platform");
    });

    expect(() => answerIncorrect()).not.toThrow();
    expect(() => sessionCompleted()).not.toThrow();
  });

  it("returns nothing, so no caller can await or branch on it", () => {
    expect(answerCorrect()).toBeUndefined();
    expect(answerIncorrect()).toBeUndefined();
    expect(sessionCompleted()).toBeUndefined();
  });
});
