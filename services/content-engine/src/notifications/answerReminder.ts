import type { Language } from "../domain.js";

/**
 * The second — and last — notification an edition can cause.
 *
 * A reader who was assigned questions and has not answered all of them is told
 * ONCE, around 08:30 in their own timezone on the morning after the edition.
 * Never a second time for the same edition, never later that day, never to a
 * reader with nothing left to answer.
 *
 * Who is owed it, and when, is not decided here. It is decided in SQL, by
 * `claim_edition_answer_reminders`, at the moment the delivery row is leased —
 * so a reader who answers the last question at 08:29 is simply never returned.
 * This file only words the message.
 */

export const ANSWER_REMINDER_NOTIFICATION_KIND = "edition_answer_reminder";

export type AnswerReminderMessage = {
  title: string;
  body: string;
  data: {
    type: typeof ANSWER_REMINDER_NOTIFICATION_KIND;
    drop_date: string;
  };
};

/** A delivery row `claim_edition_answer_reminders` leased to this worker. */
export type ClaimedAnswerReminder = {
  pushTokenId: string;
  userId: string;
  editionDate: string;
  expoPushToken: string;
  /** `profiles.language` as read in the leasing statement. */
  language: Language;
};

/**
 * Factual, not guilt: the session has answers left, and they count for the
 * competition. No count, no streak, no urgency.
 */
export function buildAnswerReminderMessage(
  language: Language,
  editionDate: string
): AnswerReminderMessage {
  const copy =
    language === "fr"
      ? {
          title: "Votre session n'est pas terminée",
          body: "Il vous reste des réponses à donner pour rester dans la compétition."
        }
      : {
          title: "Your session isn't finished",
          body: "You still have answers to submit to stay in the competition."
        };

  return {
    ...copy,
    data: { type: ANSWER_REMINDER_NOTIFICATION_KIND, drop_date: editionDate }
  };
}
