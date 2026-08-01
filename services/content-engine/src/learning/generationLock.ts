export const DEFAULT_LEARNING_GENERATION_LOCK_TIMEOUT_MINUTES = 15;
export const DEFAULT_LEARNING_GENERATION_MAX_ATTEMPTS = 3;

export type LearningGenerationLockState = {
  generation_status: string;
  generation_attempts: number | null;
  generation_locked_at: string | null;
};

export function readLearningGenerationLockTimeoutMinutes(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number.parseInt(env.LEARNING_GENERATION_LOCK_TIMEOUT_MINUTES ?? "", 10);

  if (!Number.isFinite(raw) || raw < 1) {
    return DEFAULT_LEARNING_GENERATION_LOCK_TIMEOUT_MINUTES;
  }

  return Math.min(raw, 24 * 60);
}

/**
 * A session that is still `generating` belongs to the worker holding the lock,
 * unless that lock is older than the timeout: only then may it be taken over.
 * `ready` sessions are never reclaimed; `queued` and `failed` ones always are.
 */
export function isReclaimableLearningSession(
  session: LearningGenerationLockState,
  options: { nowMs?: number; lockTimeoutMinutes?: number } = {}
): boolean {
  const nowMs = options.nowMs ?? Date.now();
  const lockTimeoutMs = (options.lockTimeoutMinutes ?? readLearningGenerationLockTimeoutMinutes()) * 60_000;

  if (session.generation_status === "ready") {
    return false;
  }

  if (session.generation_status !== "generating") {
    return true;
  }

  if (!session.generation_locked_at) {
    return true;
  }

  const lockedAtMs = Date.parse(session.generation_locked_at);
  if (!Number.isFinite(lockedAtMs)) {
    return true;
  }

  return nowMs - lockedAtMs >= lockTimeoutMs;
}
