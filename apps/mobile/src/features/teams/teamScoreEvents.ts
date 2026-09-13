/**
 * "A Team score this reader contributes to has just changed."
 *
 * Said by the one place that knows it first: the quiz, the moment
 * `submit_question_answer` reports the answer counted for at least one Team
 * (`teams_scored > 0`). Team screens that are mounted refetch the standing from
 * the server on it — nothing here carries a score, so nothing can be shown
 * that the server has not confirmed.
 *
 * The Realtime broadcast tells team-MATES; this tells the reader's own screens
 * without depending on a socket being up.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function onTeamScoresChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyTeamScoresChanged(): void {
  listeners.forEach((listener) => listener());
}
