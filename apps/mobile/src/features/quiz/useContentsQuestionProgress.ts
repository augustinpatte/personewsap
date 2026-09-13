import { useMemo } from "react";

import { useAuth } from "../auth";
import { summarizeContentProgress, type ContentQuestionProgress } from "./questionProgress";
import { useQuestionAttempts } from "./questionProgressData";

/**
 * Question progress for a whole list — Today's rows, an archive page — in one
 * server read for the list, never one per row.
 *
 * Only readings that have questions get an entry, and none is returned until
 * the server has answered: a row shows its real "Questions · 1/2" or nothing,
 * never a guessed 0/2.
 */
export function useContentsQuestionProgress(
  entries: Array<{ id: string; questionIds: string[] }>
): ReadonlyMap<string, ContentQuestionProgress> {
  const { user } = useAuth();
  const withQuestions = entries.filter((entry) => entry.questionIds.length > 0);
  const entriesKey = withQuestions
    .map((entry) => `${entry.id}=${entry.questionIds.join(",")}`)
    .join(";");
  const attempts = useQuestionAttempts(
    withQuestions.flatMap((entry) => entry.questionIds),
    user?.id ?? null
  );

  return useMemo(() => {
    const byItem = new Map<string, ContentQuestionProgress>();

    if (!attempts.loaded) {
      return byItem;
    }

    const now = Date.now();

    for (const entry of withQuestions) {
      byItem.set(entry.id, summarizeContentProgress(entry.questionIds, attempts.records, now));
    }

    return byItem;
    // `withQuestions` is rebuilt every render; its key is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts, entriesKey]);
}
