import { useMemo } from "react";

import { useAuth } from "../auth";
import type { DailyDropContentItem } from "../today/contentTypes";
import { readItemQuestions } from "./itemQuestions";
import { settledSeeds, summarizeContentProgress } from "./questionProgress";
import { useQuestionAttempts } from "./questionProgressData";

/**
 * A reading's questions and the reader's progress on them, before any quiz is
 * opened: the ids (this content's own, shared by FR and EN), the server's
 * progress, and the settled questions the quiz must not start again.
 *
 * Null-safe on a missing item, so readers can call it above their guard.
 */
export function useReadingQuestions(item: DailyDropContentItem | null | undefined) {
  const { user } = useAuth();
  const { questions, teams } = readItemQuestions(item);
  const ids = questions.map((question) => question.logicalQuestionId);
  const idsKey = ids.join("|");
  const attempts = useQuestionAttempts(ids, user?.id ?? null);

  const progress = useMemo(
    () => summarizeContentProgress(ids, attempts.records, Date.now()),
    // `ids` is rebuilt every render; its key is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey, attempts.records]
  );
  const settled = useMemo(
    () => settledSeeds(ids, attempts.records),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey, attempts.records]
  );

  return { questions, teams, progress, progressKnown: attempts.loaded, settled };
}
