import type { LearningFeedbackRatings } from "./learningTypes";

export const LEARNING_OUTBOX_KEY_V1 = "personewsap:learning-session-outbox:v1";
export const LEARNING_OUTBOX_KEY_PREFIX = "personewsap:learning-outbox:v2";

export type LearningOutboxEvent =
  | {
      sessionId: string;
      eventType: "started";
      createdAt: string;
      attemptCount: number;
      lastAttemptAt: string | null;
    }
  | {
      sessionId: string;
      eventType: "feedback";
      ratings: LearningOutboxFeedbackRatings;
      createdAt: string;
      attemptCount: number;
      lastAttemptAt: string | null;
    };

export type LearningOutboxFeedbackRatings = {
  comprehension: number;
  explainability: number;
  interest: number;
  difficulty: number;
};

export type LearningOutboxStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type LearningOutboxSessionGroup = {
  sessionId: string;
  events: LearningOutboxEvent[];
};

export type LearningOutboxSyncFailure = {
  event: LearningOutboxEvent;
  error: unknown;
  retryable: boolean;
};

export type LearningOutboxSyncResult<TSession> = {
  remaining: LearningOutboxEvent[];
  failures: LearningOutboxSyncFailure[];
  syncedSessions: TSession[];
};

export type LearningFeedbackSyncOutcome =
  | { ok: true; syncPending: false }
  | { ok: true; syncPending: true }
  | { ok: false; syncPending: false };

export type LearningOutboxSyncDependencies<TSession> = {
  startSession(sessionId: string): Promise<TSession | null>;
  submitFeedback(sessionId: string, ratings: LearningOutboxFeedbackRatings): Promise<TSession | null>;
  now(): string;
};

export function getLearningOutboxKey(userId: string | null | undefined): string {
  return `${LEARNING_OUTBOX_KEY_PREFIX}:${userId ?? "anonymous"}`;
}

export async function readLearningOutbox(
  storage: LearningOutboxStorage,
  userId: string | null | undefined
): Promise<LearningOutboxEvent[]> {
  const currentKey = getLearningOutboxKey(userId);
  const [current, legacy] = await Promise.all([
    storage.getItem(currentKey),
    userId ? storage.getItem(LEARNING_OUTBOX_KEY_V1) : Promise.resolve(null)
  ]);
  const currentEvents = parseLearningOutbox(current);
  const legacyEvents = parseLearningOutbox(legacy);
  const merged = orderLearningOutboxEvents(dedupeLearningOutbox([...legacyEvents, ...currentEvents]));

  if (legacyEvents.length > 0) {
    await storage.setItem(currentKey, JSON.stringify(merged));
    await storage.removeItem(LEARNING_OUTBOX_KEY_V1);
  }

  return merged;
}

export async function writeLearningOutbox(
  storage: LearningOutboxStorage,
  userId: string | null | undefined,
  events: LearningOutboxEvent[]
): Promise<void> {
  await storage.setItem(
    getLearningOutboxKey(userId),
    JSON.stringify(orderLearningOutboxEvents(dedupeLearningOutbox(events)))
  );
}

export function upsertLearningOutboxEvent(
  events: LearningOutboxEvent[],
  event: LearningOutboxEvent
): LearningOutboxEvent[] {
  return orderLearningOutboxEvents(dedupeLearningOutbox([...events, event]));
}

export function removeLearningOutboxEvent(
  events: LearningOutboxEvent[],
  sessionId: string,
  eventType?: LearningOutboxEvent["eventType"]
): LearningOutboxEvent[] {
  return events.filter(
    (event) => event.sessionId !== sessionId || (eventType ? event.eventType !== eventType : false)
  );
}

export function retryLearningOutboxEvent(event: LearningOutboxEvent, now: string): LearningOutboxEvent {
  return {
    ...event,
    attemptCount: event.attemptCount + 1,
    lastAttemptAt: now
  };
}

export function groupLearningOutboxEventsBySession(
  events: LearningOutboxEvent[]
): LearningOutboxSessionGroup[] {
  const orderedEvents = orderLearningOutboxEvents(dedupeLearningOutbox(events));
  const groups = new Map<string, LearningOutboxEvent[]>();

  for (const event of orderedEvents) {
    groups.set(event.sessionId, [...(groups.get(event.sessionId) ?? []), event]);
  }

  return [...groups.entries()].map(([sessionId, groupedEvents]) => ({
    sessionId,
    events: groupedEvents
  }));
}

export async function flushLearningOutboxEvents<TSession>(
  events: LearningOutboxEvent[],
  dependencies: LearningOutboxSyncDependencies<TSession>
): Promise<LearningOutboxSyncResult<TSession>> {
  let remaining: LearningOutboxEvent[] = [];
  const failures: LearningOutboxSyncFailure[] = [];
  const syncedSessions: TSession[] = [];

  for (const group of groupLearningOutboxEventsBySession(events)) {
    const started = group.events.find((event) => event.eventType === "started");
    const feedback = group.events.find((event) => event.eventType === "feedback");
    let startedSynced = true;

    if (started) {
      try {
        const syncedSession = await dependencies.startSession(started.sessionId);
        if (syncedSession) {
          syncedSessions.push(syncedSession);
        }
      } catch (error) {
        const retryable = isRetryableLearningSyncError(error);
        startedSynced = false;
        failures.push({
          event: started,
          error,
          retryable
        });

        if (retryable) {
          remaining = upsertLearningOutboxEvent(
            remaining,
            retryLearningOutboxEvent(started, dependencies.now())
          );
        } else if (feedback) {
          failures.push({
            event: feedback,
            error,
            retryable: false
          });
        }
      }
    }

    if (!startedSynced) {
      const startedFailure = failures.find(
        (failure) => failure.event === started && failure.event.eventType === "started"
      );
      if (feedback && startedFailure?.retryable === true) {
        remaining = upsertLearningOutboxEvent(remaining, feedback);
      }
      continue;
    }

    if (feedback) {
      try {
        const syncedSession = await dependencies.submitFeedback(feedback.sessionId, feedback.ratings);
        if (syncedSession) {
          syncedSessions.push(syncedSession);
        }
      } catch (error) {
        const retryable = isRetryableLearningSyncError(error);
        failures.push({
          event: feedback,
          error,
          retryable
        });
        if (retryable) {
          remaining = upsertLearningOutboxEvent(
            remaining,
            retryLearningOutboxEvent(feedback, dependencies.now())
          );
        }
      }
    }
  }

  return {
    remaining: orderLearningOutboxEvents(remaining),
    failures,
    syncedSessions
  };
}

export function isRetryableLearningSyncError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const status = typeof record.status === "number" ? record.status : Number(record.status);
  const code = typeof record.code === "string" ? record.code : null;
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";

  if (status === 401 || status === 403 || code === "401" || code === "403" || code === "P0002" || code === "22023") {
    return false;
  }

  if (Number.isFinite(status) && status >= 500 && status <= 599) {
    return true;
  }

  return (
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  );
}

export function resolveLearningFeedbackSyncOutcome(input: {
  feedbackStillLocal: boolean;
  blockingFailure: LearningOutboxSyncFailure | null;
}): LearningFeedbackSyncOutcome {
  if (input.blockingFailure?.retryable === false) {
    return { ok: false, syncPending: false };
  }

  if (!input.feedbackStillLocal) {
    return { ok: true, syncPending: false };
  }

  if (input.blockingFailure?.retryable === true) {
    return { ok: true, syncPending: true };
  }

  return { ok: false, syncPending: false };
}

export function shouldCompleteLearningSessionLocally(outcome: LearningFeedbackSyncOutcome): boolean {
  return outcome.ok;
}

export function parseLearningOutbox(value: string | null): LearningOutboxEvent[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((event): LearningOutboxEvent | null => {
        if (!event || typeof event !== "object") {
          return null;
        }
        const record = event as Partial<LearningOutboxEvent>;
        if (typeof record.sessionId !== "string") {
          return null;
        }
        if (record.eventType === "started") {
          return baseEvent(record.sessionId, "started", record);
        }
        if (record.eventType === "feedback" && hasRatings(record.ratings)) {
          return {
            ...baseEvent(record.sessionId, "feedback", record),
            ratings: record.ratings
          };
        }
        return null;
      })
      .filter((event): event is LearningOutboxEvent => Boolean(event));
  } catch {
    return [];
  }
}

function dedupeLearningOutbox(events: LearningOutboxEvent[]): LearningOutboxEvent[] {
  const byKey = new Map<string, LearningOutboxEvent>();

  for (const event of events) {
    byKey.set(`${event.sessionId}:${event.eventType}`, event);
  }

  return [...byKey.values()];
}

function orderLearningOutboxEvents(events: LearningOutboxEvent[]): LearningOutboxEvent[] {
  return [...events].sort((left, right) => {
    if (left.sessionId !== right.sessionId) {
      return left.createdAt.localeCompare(right.createdAt);
    }
    if (left.eventType === right.eventType) {
      return left.createdAt.localeCompare(right.createdAt);
    }
    return left.eventType === "started" ? -1 : 1;
  });
}

function baseEvent<T extends LearningOutboxEvent["eventType"]>(
  sessionId: string,
  eventType: T,
  record: Partial<LearningOutboxEvent>
) {
  return {
    sessionId,
    eventType,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    attemptCount: Number.isFinite(record.attemptCount) ? Number(record.attemptCount) : 0,
    lastAttemptAt: typeof record.lastAttemptAt === "string" ? record.lastAttemptAt : null
  };
}

function hasRatings(value: unknown): value is LearningOutboxFeedbackRatings {
  if (!value || typeof value !== "object") {
    return false;
  }
  const ratings = value as LearningFeedbackRatings;
  return (
    isRating(ratings.comprehension) &&
    isRating(ratings.explainability) &&
    isRating(ratings.interest) &&
    isRating(ratings.difficulty)
  );
}

function isRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}
