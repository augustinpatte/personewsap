import * as Haptics from "expo-haptics";

/**
 * The three moments PersoNewsAP is allowed to touch you.
 *
 * Haptics earn their place only where something was decided — an answer
 * committed, a session finished. Everything else in this app is navigation, and
 * navigation is silent: opening a reading, switching tabs, scrolling an
 * archive, changing language and pressing a card all stay quiet on purpose. A
 * device that buzzes at every tap trains people to stop noticing it, which
 * costs exactly the moments this file exists to mark.
 *
 * Note what is deliberately absent: an `answerSelected()`. In both Mini Case
 * flows, choosing an option is the same event as learning whether it was right
 * — the feedback is revealed on that tap, not on a later one. Firing a
 * selection tick and then an outcome notification would be two buzzes for one
 * decision, so the outcome-shaped haptic is the one that fires, and it carries
 * the "registered" meaning too.
 *
 * Every call is fire-and-forget and swallows its own failure. Haptics are
 * feedback about a product action, never part of one: if the Taptic Engine is
 * unavailable, busy, or the platform has no haptics at all, the answer must
 * still submit and the screen must still advance.
 */

function fire(run: () => Promise<void>): void {
  try {
    void run().catch(() => {
      // Unavailable engine, unsupported platform, OS refusal: nothing the
      // reader needs to know about, and nothing the caller should handle.
    });
  } catch {
    // Some platforms throw synchronously rather than rejecting.
  }
}

/** A correct answer, the instant it is revealed. Restrained on purpose. */
export function answerCorrect(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/**
 * A wrong answer. Warning, never Error: the reader made a normal move in a
 * learning exercise, and the harsher pattern is for destruction and failure.
 */
export function answerIncorrect(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/**
 * A learning session finished — the feedback was accepted and the session is
 * recorded. The only completion haptic in the app, and it fires nowhere near a
 * Mini Case answer, so it can never land as a second buzz.
 */
export function sessionCompleted(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}
