import type { AttemptRecord } from "./questionProgress";

/**
 * The attempts this session knows about, shared by every surface that shows
 * question progress — the reader's buttons, Today's rows, the archive.
 *
 * Filled from the server (`questionProgressData.ts`) and kept current by the
 * quiz itself, so answering a question updates the row the reader returns to
 * without waiting for a refetch. The server stays the authority: every surface
 * refetches when it opens, and the store is per signed-in reader.
 *
 * `null` means the server was asked and holds no attempt for that question.
 * Deliberately free of any Supabase import, so the quiz flow can write to it
 * without pulling the client into its tests.
 */

type Known = AttemptRecord | null;

const records = new Map<string, Known>();
const listeners = new Set<() => void>();
let version = 0;
let owner: string | null = null;

function emit() {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function subscribeQuestionProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function questionProgressVersion(): number {
  return version;
}

export function questionProgressOwner(): string | null {
  return owner;
}

/** One reader's attempts never show on another's account. */
export function setQuestionProgressOwner(userId: string | null): void {
  if (owner === userId) {
    return;
  }

  owner = userId;
  records.clear();
  emit();
}

export function knownAttempt(logicalQuestionId: string): Known | undefined {
  return records.get(logicalQuestionId);
}

/**
 * A submitted attempt is final: a read that started before it was submitted
 * cannot turn it back into an open one. Nor can a read that found nothing erase
 * an attempt this session has just opened.
 */
export function mergeAttempt(existing: Known | undefined, incoming: Known): Known {
  if (existing?.status === "submitted") {
    return existing;
  }

  if (incoming === null && existing) {
    return existing;
  }

  return incoming;
}

/** A server read: every id asked about, with its row or with none. */
export function storeAttempts(ids: string[], rows: AttemptRecord[]): void {
  const byId = new Map(rows.map((row) => [row.logicalQuestionId, row]));

  for (const id of ids) {
    records.set(id, mergeAttempt(records.get(id), byId.get(id) ?? null));
  }

  emit();
}

/** What the quiz just learnt from the server: an attempt opened or settled. */
export function recordAttempt(record: AttemptRecord): void {
  const existing = records.get(record.logicalQuestionId);
  // An in-session settle is authoritative over an in-session open.
  records.set(
    record.logicalQuestionId,
    record.status === "submitted" ? record : mergeAttempt(existing, record)
  );
  emit();
}

/** Tests and sign-out. */
export function resetQuestionProgress(): void {
  owner = null;
  records.clear();
  emit();
}
