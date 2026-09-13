import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { supabase } from "../../lib/supabase";
import type { AttemptRecord } from "./questionProgress";
import {
  knownAttempt,
  questionProgressOwner,
  questionProgressVersion,
  setQuestionProgressOwner,
  storeAttempts,
  subscribeQuestionProgress
} from "./questionProgressStore";
import type { QuestionScoreTier } from "./quizSession";

/**
 * The reader's own attempts, from `public.question_attempts`.
 *
 * RLS returns only `user_id = auth.uid()`. The columns read here are the ones a
 * progress needs; `score_milli` is NULL on an open attempt by construction and
 * only ever populated once the reader has submitted, so nothing here can reveal
 * an answer before it is given. No `start_question_attempt` is called: reading
 * progress never opens an attempt.
 */

const attemptSelect =
  "logical_question_id,status,deadline_at,submitted_at,selected_option_id,score_milli";
const ID_BATCH_SIZE = 100;

function readTier(value: unknown): QuestionScoreTier {
  return value === 300 || value === 600 || value === 1000 ? value : 0;
}

export function mapAttemptRow(row: Record<string, unknown>): AttemptRecord | null {
  const logicalQuestionId =
    typeof row.logical_question_id === "string" ? row.logical_question_id : "";

  if (!logicalQuestionId) {
    return null;
  }

  const submitted = row.status === "submitted";
  const deadlineAt = typeof row.deadline_at === "string" ? row.deadline_at : null;
  const submittedAt = typeof row.submitted_at === "string" ? row.submitted_at : null;

  return {
    logicalQuestionId,
    status: submitted ? "submitted" : "in_progress",
    deadlineAt,
    // The same comparison the server made at submit time, read off the row.
    expired:
      submitted &&
      submittedAt !== null &&
      deadlineAt !== null &&
      Date.parse(submittedAt) > Date.parse(deadlineAt),
    selectedOptionId:
      typeof row.selected_option_id === "string" ? row.selected_option_id : null,
    scoreMilli: submitted ? readTier(row.score_milli) : null
  };
}

/** Asks the server about these questions. False when it could not answer. */
export async function fetchQuestionAttempts(ids: string[]): Promise<boolean> {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];

  if (!supabase || unique.length === 0) {
    return false;
  }

  try {
    const rows: AttemptRecord[] = [];

    for (let start = 0; start < unique.length; start += ID_BATCH_SIZE) {
      const batch = unique.slice(start, start + ID_BATCH_SIZE);
      const { data, error } = await supabase
        .from("question_attempts")
        .select(attemptSelect)
        .in("logical_question_id", batch);

      if (error || !data) {
        return false;
      }

      for (const row of data as Array<Record<string, unknown>>) {
        const record = mapAttemptRow(row);

        if (record) {
          rows.push(record);
        }
      }
    }

    storeAttempts(unique, rows);
    return true;
  } catch {
    return false;
  }
}

/**
 * The progress of a set of logical questions, kept live.
 *
 * Fetched from the server whenever the set (or the reader) changes — which is
 * every time a surface opens, so a restart or another device is always
 * reflected — and updated in place by the quiz between fetches.
 */
export function useQuestionAttempts(
  ids: string[],
  userId: string | null
): { records: ReadonlyMap<string, AttemptRecord | null>; loaded: boolean } {
  const idsKey = [...new Set(ids.filter((id) => id.length > 0))].sort().join("|");
  const version = useSyncExternalStore(
    subscribeQuestionProgress,
    questionProgressVersion,
    questionProgressVersion
  );
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || idsKey.length === 0) {
      return;
    }

    setQuestionProgressOwner(userId);
    let active = true;

    void fetchQuestionAttempts(idsKey.split("|")).then((ok) => {
      if (active && ok) {
        setFetchedKey(`${userId}:${idsKey}`);
      }
    });

    return () => {
      active = false;
    };
  }, [idsKey, userId]);

  return useMemo(() => {
    const view = new Map<string, AttemptRecord | null>();
    const mine = userId !== null && questionProgressOwner() === userId;

    if (!mine || idsKey.length === 0) {
      return { records: view, loaded: false };
    }

    let allKnown = true;

    for (const id of idsKey.split("|")) {
      const known = knownAttempt(id);

      if (known === undefined) {
        allKnown = false;
        continue;
      }

      view.set(id, known);
    }

    return { records: view, loaded: allKnown || fetchedKey === `${userId}:${idsKey}` };
    // `version` is the store's change counter: it is what re-reads the records.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedKey, idsKey, userId, version]);
}
