/**
 * Library access policy.
 *
 * A new reader is never drowned in the full archive: they get the current
 * edition plus the four previous ones (five most recent editions). Everything
 * older stays stored and referenced in the library but is not readable yet.
 *
 * Access then widens automatically with tenure — one extra edition per day of
 * account age — until the whole archive is eventually unlocked. This rewards
 * loyalty while preserving the value of the historical content.
 *
 * The policy is a pure, recency-rank gate (rank 0 = most recent edition), so it
 * is deterministic, testable, and needs no backend change. Tenure is read from
 * profiles.created_at.
 */

/** Current edition + 4 previous editions are always readable. */
export const BASE_UNLOCKED_EDITIONS = 5;

/** Editions unlocked per day of tenure. */
export const EDITIONS_UNLOCKED_PER_DAY = 1;

const MS_PER_DAY = 86_400_000;

/** Whole days between account creation and `now`, clamped to ≥ 0. */
export function tenureDays(
  createdAt: string | null | undefined,
  now: Date = new Date()
): number {
  if (!createdAt) {
    return 0;
  }

  const created = new Date(createdAt);

  if (Number.isNaN(created.getTime())) {
    return 0;
  }

  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / MS_PER_DAY));
}

/** How many of the most recent editions the reader may open. */
export function unlockedEditionCount(
  createdAt: string | null | undefined,
  now: Date = new Date()
): number {
  return BASE_UNLOCKED_EDITIONS + tenureDays(createdAt, now) * EDITIONS_UNLOCKED_PER_DAY;
}

/**
 * Whether the edition at the given recency rank (0 = most recent) is readable.
 */
export function isEditionUnlocked(
  recencyRank: number,
  createdAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  return recencyRank < unlockedEditionCount(createdAt, now);
}
