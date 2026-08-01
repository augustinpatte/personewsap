import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

import { trackAnalyticsEvent } from "../../lib/analytics";
import type { DataFetchSource } from "../../lib/dataState";
import {
  getSupabaseConfigError,
  hasSupabaseConfig,
  normalizeSupabaseError,
  supabase,
  type NormalizedSupabaseError
} from "../../lib/supabase";
import { useAuth } from "../auth";
import {
  learningDomainOrder,
  mockLearningDomains,
  mockLearningObjectives,
  mockLearningPath,
  mockLearningSessions
} from "./learningData";
import type {
  LearningCurrentLevel,
  LearningDomain,
  LearningObjective,
  LearningPath,
  LearningPathBundle,
  LearningSession,
  LearningTargetLevel
} from "./learningTypes";

type LearningPathContextValue = LearningPathBundle & {
  status: "loading" | "ready" | "error";
  source: DataFetchSource;
  error: NormalizedSupabaseError | null;
  learningPathEnabled: boolean;
  learningPathChoiceCompleted: boolean;
  startPath: (params: {
    domainId: string;
    objectiveId: string;
    currentLevel: LearningCurrentLevel;
    targetLevel: LearningTargetLevel;
  }) => Promise<{ ok: boolean; error: NormalizedSupabaseError | null }>;
  submitFeedback: (
    sessionId: string,
    ratings: {
      comprehension: number;
      explainability: number;
      interest: number;
      difficulty: number;
    }
  ) => Promise<{ ok: boolean; error: NormalizedSupabaseError | null }>;
  markSessionOpened: (
    sessionId: string
  ) => Promise<{ ok: boolean; error: NormalizedSupabaseError | null }>;
  markSessionStarted: (
    sessionId: string
  ) => Promise<{ ok: boolean; error: NormalizedSupabaseError | null }>;
  recordSessionStartedAfterPromptCopy: (
    sessionId: string
  ) => Promise<{ ok: boolean; error: NormalizedSupabaseError | null; syncPending: boolean }>;
  disableLearningPath: () => Promise<{ ok: boolean; error: NormalizedSupabaseError | null }>;
  getSessionById: (sessionId: string) => LearningSession | undefined;
  reload: () => Promise<void>;
};

const LearningPathContext = createContext<LearningPathContextValue | null>(null);

type LearningPathState = LearningPathBundle & {
  status: "loading" | "ready" | "error";
  source: DataFetchSource;
  error: NormalizedSupabaseError | null;
  learningPathEnabled: boolean;
  learningPathChoiceCompleted: boolean;
};

type LearningOutboxEvent = {
  sessionId: string;
  eventType: "started";
  createdAt: string;
  attemptCount: number;
  lastAttemptAt: string | null;
};

const LEARNING_SESSION_OUTBOX_KEY = "personewsap:learning-session-outbox:v1";

const initialBundle = createBundle({
  domains: mockLearningDomains,
  objectives: mockLearningObjectives,
  path: null,
  sessions: []
});

export function LearningPathProvider({ children }: PropsWithChildren) {
  const { profileLanguage, status: authStatus, user } = useAuth();
  const [state, setState] = useState<LearningPathState>({
    ...initialBundle,
    status: "loading",
    source: "mock",
    error: null,
    learningPathEnabled: false,
    learningPathChoiceCompleted: false
  });

  const updateSessionLocally = useCallback((sessionId: string, patch: Partial<LearningSession>) => {
    setState((current) => {
      const sessions = current.sessions.map((session) =>
        session.id === sessionId ? { ...session, ...patch } : session
      );

      return {
        ...current,
        ...createBundle({
          domains: current.domains,
          objectives: current.objectives,
          path: current.activePath,
          sessions
        })
      };
    });
  }, []);

  const load = useCallback(
    async (isActive: () => boolean = () => true) => {
      setState((current) => ({ ...current, status: "loading", error: null }));

      if (authStatus !== "ready" || !user?.id || !hasSupabaseConfig || !supabase) {
        const mockBundle = createBundle({
          domains: mockLearningDomains,
          objectives: mockLearningObjectives,
          path: hasSupabaseConfig ? null : mockLearningPath,
          sessions: hasSupabaseConfig ? [] : mockLearningSessions
        });

        if (isActive()) {
          setState({
            ...mockBundle,
            status: "ready",
            source: "mock",
            error: hasSupabaseConfig ? null : getSupabaseConfigError(),
            learningPathEnabled: false,
            learningPathChoiceCompleted: false
          });
        }
        return;
      }

      try {
        await flushLearningOutbox({
          userId: user.id,
          onSynced: (session) => updateSessionLocally(session.id, session)
        });

        const healthResult = await supabase.rpc("learning_paths_healthcheck");
        if (healthResult.error) {
          throw healthResult.error;
        }
        if (!isLearningHealthcheckReady(healthResult.data)) {
          throw {
            code: "learning_schema_incomplete",
            message: "Learning path schema is incomplete.",
            details: JSON.stringify(healthResult.data)
          };
        }

        const [domainResult, objectiveResult, preferencesResult, pathResult] = await Promise.all([
          supabase
            .from("learning_domains")
            .select("id, slug, label_fr, label_en, description_fr, description_en, position")
            .order("position", { ascending: true }),
          supabase
            .from("learning_objectives")
            .select("id, domain_id, slug, label_fr, label_en, description_fr, description_en, position")
            .order("position", { ascending: true }),
          supabase
            .from("user_preferences")
            .select("learning_path_enabled, learning_path_choice_completed")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("user_learning_paths")
            .select(
              "id, user_id, domain_id, objective_id, current_level, target_level, language, status, created_at, updated_at, archived_at"
            )
            .eq("user_id", user.id)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        ]);

        if (domainResult.error) {
          throw domainResult.error;
        }
        if (objectiveResult.error) {
          throw objectiveResult.error;
        }
        if (preferencesResult.error) {
          throw preferencesResult.error;
        }
        if (pathResult.error) {
          throw pathResult.error;
        }

        const path = coercePath(pathResult.data);
        let sessions: LearningSession[] = [];

        if (path) {
          const sessionResult = await supabase
            .from("learning_sessions")
            .select(
              "id, path_id, daily_drop_id, curriculum_step_key, session_number, adaptation_mode, title_fr, title_en, summary_fr, summary_en, objectives_fr, objectives_en, prompt_text, generation_status, status, available_on, opened_at, started_at, completed_at, created_at"
            )
            .eq("path_id", path.id)
            .eq("generation_status", "ready")
            .order("session_number", { ascending: true });

          if (sessionResult.error) {
            throw sessionResult.error;
          }

          sessions = (sessionResult.data ?? []).map(coerceSession);
        }

        const bundle = createBundle({
          domains: orderDomains((domainResult.data ?? []).map(coerceDomain)),
          objectives: (objectiveResult.data ?? []).map(coerceObjective),
          path,
          sessions
        });

        if (isActive()) {
          setState({
            ...bundle,
            status: "ready",
            source: "supabase",
            error: null,
            learningPathEnabled: preferencesResult.data?.learning_path_enabled === true,
            learningPathChoiceCompleted:
              preferencesResult.data?.learning_path_choice_completed === true
          });
        }
      } catch (error) {
        const normalized = normalizeSupabaseError(error, "Could not load your learning path.");

        if (isActive()) {
          setState({
            ...createBundle({ domains: [], objectives: [], path: null, sessions: [] }),
            status: "error",
            source: "supabase",
            error: normalized,
            learningPathEnabled: false,
            learningPathChoiceCompleted: false
          });
        }
      }
    },
    [authStatus, updateSessionLocally, user?.id]
  );

  useEffect(() => {
    let isMounted = true;
    void load(() => isMounted);

    return () => {
      isMounted = false;
    };
  }, [load]);

  const startPath = useCallback<LearningPathContextValue["startPath"]>(
    async ({ currentLevel, domainId, objectiveId, targetLevel }) => {
      if (!supabase || !user?.id) {
        return {
          ok: false,
          error: normalizeSupabaseError(getSupabaseConfigError(), "Learning setup is unavailable.")
        };
      }

      try {
        const { data, error } = await supabase.rpc("start_learning_path", {
          p_domain_id: domainId,
          p_objective_id: objectiveId,
          p_current_level: currentLevel,
          p_target_level: targetLevel
        });

        if (error) {
          throw error;
        }
        if (typeof data !== "string" || data.length < 16) {
          throw {
            code: "learning_path_create_unverified",
            message: "start_learning_path did not return a valid path id."
          };
        }

        trackAnalyticsEvent("learning_path_started", {
          language: profileLanguage ?? undefined
        });

        await load();
        const { data: verifiedPath, error: verifyError } = await supabase
          .from("user_learning_paths")
          .select("id")
          .eq("id", data)
          .eq("user_id", user.id)
          .eq("status", "active")
          .maybeSingle();

        if (verifyError) {
          throw verifyError;
        }
        if (!verifiedPath) {
          throw {
            code: "learning_path_create_unverified",
            message: "The learning path was not visible after creation."
          };
        }

        return { ok: true, error: null };
      } catch (error) {
        if (__DEV__) {
          console.warn("[LearningPath] startPath failed", error);
        }
        return {
          ok: false,
          error: normalizeSupabaseError(error, "Could not create your learning path.")
        };
      }
    },
    [load, profileLanguage, user?.id]
  );

  const disableLearningPath = useCallback<LearningPathContextValue["disableLearningPath"]>(
    async () => {
      if (!supabase || !user?.id) {
        return {
          ok: false,
          error: normalizeSupabaseError(getSupabaseConfigError(), "Learning path settings are unavailable.")
        };
      }

      try {
        const { error } = await supabase.rpc("disable_learning_path");
        if (error) {
          throw error;
        }
        await clearLearningSetupDraft();
        await load();
        return { ok: true, error: null };
      } catch (error) {
        if (__DEV__) {
          console.warn("[LearningPath] disableLearningPath failed", error);
        }
        return {
          ok: false,
          error: normalizeSupabaseError(error, "Could not disable your learning path.")
        };
      }
    },
    [load, user?.id]
  );

  const submitFeedback = useCallback<LearningPathContextValue["submitFeedback"]>(
    async (sessionId, ratings) => {
      if (!supabase || !user?.id) {
        return {
          ok: false,
          error: normalizeSupabaseError(getSupabaseConfigError(), "Feedback is unavailable.")
        };
      }

      try {
        const { error } = await supabase.rpc("submit_learning_session_feedback", {
          p_session_id: sessionId,
          p_comprehension_rating: ratings.comprehension,
          p_explainability_rating: ratings.explainability,
          p_interest_rating: ratings.interest,
          p_difficulty_rating: ratings.difficulty
        });

        if (error) {
          throw error;
        }

        trackAnalyticsEvent("learning_feedback_submitted", {
          language: profileLanguage ?? undefined
        });

        await load();
        return { ok: true, error: null };
      } catch (error) {
        return {
          ok: false,
          error: normalizeSupabaseError(error, "Could not save your learning feedback.")
        };
      }
    },
    [load, profileLanguage, user?.id]
  );

  const markSessionOpened = useCallback<LearningPathContextValue["markSessionOpened"]>(
    async (sessionId) => {
      const currentSession = state.sessions.find((session) => session.id === sessionId);

      if (!currentSession || currentSession.status !== "available") {
        return { ok: true, error: null };
      }

      if (!supabase || !user?.id || state.source === "mock") {
        updateSessionLocally(sessionId, {
          opened_at: currentSession.opened_at ?? new Date().toISOString(),
          status: "opened"
        });
        return { ok: true, error: null };
      }

      try {
        const { data, error } = await supabase.rpc("open_learning_session", {
          p_session_id: sessionId
        });

        if (error) {
          throw error;
        }

        if (data) {
          updateSessionLocally(sessionId, coerceSession(data as LearningSession));
        }
        return { ok: true, error: null };
      } catch (error) {
        return {
          ok: false,
          error: normalizeSupabaseError(error, "Could not mark your session as opened.")
        };
      }
    },
    [state.sessions, state.source, updateSessionLocally, user?.id]
  );

  const markSessionStarted = useCallback<LearningPathContextValue["markSessionStarted"]>(
    async (sessionId) => {
      const currentSession = state.sessions.find((session) => session.id === sessionId);

      if (
        !currentSession ||
        currentSession.status === "started" ||
        currentSession.status === "completed"
      ) {
        return { ok: true, error: null };
      }

      const now = new Date().toISOString();

      if (!supabase || !user?.id || state.source === "mock") {
        updateSessionLocally(sessionId, {
          opened_at: currentSession.opened_at ?? now,
          started_at: currentSession.started_at ?? now,
          status: "started"
        });
        await removeLearningOutboxEvent(sessionId);
        trackAnalyticsEvent("learning_session_started", {
          language: profileLanguage ?? undefined
        });
        return { ok: true, error: null };
      }

      try {
        const { data, error } = await supabase.rpc("start_learning_session", {
          p_session_id: sessionId
        });

        if (error) {
          throw error;
        }

        if (data) {
          updateSessionLocally(sessionId, coerceSession(data as LearningSession));
        }
        await removeLearningOutboxEvent(sessionId);
        trackAnalyticsEvent("learning_session_started", {
          language: profileLanguage ?? undefined
        });
        return { ok: true, error: null };
      } catch (error) {
        return {
          ok: false,
          error: normalizeSupabaseError(error, "Could not start your learning session.")
        };
      }
    },
    [profileLanguage, state.sessions, state.source, updateSessionLocally, user?.id]
  );

  const recordSessionStartedAfterPromptCopy = useCallback<
    LearningPathContextValue["recordSessionStartedAfterPromptCopy"]
  >(
    async (sessionId) => {
      await enqueueLearningOutboxEvent(sessionId);
      const result = await markSessionStarted(sessionId);
      return {
        ...result,
        syncPending: !result.ok
      };
    },
    [markSessionStarted]
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void flushLearningOutbox({
          userId: user?.id ?? null,
          onSynced: (session) => updateSessionLocally(session.id, session)
        });
      }
    });

    return () => subscription.remove();
  }, [updateSessionLocally, user?.id]);

  const value = useMemo<LearningPathContextValue>(
    () => ({
      ...state,
      disableLearningPath,
      markSessionOpened,
      markSessionStarted,
      recordSessionStartedAfterPromptCopy,
      startPath,
      submitFeedback,
      getSessionById: (sessionId) => state.sessions.find((session) => session.id === sessionId),
      reload: () => load()
    }),
    [
      disableLearningPath,
      load,
      markSessionOpened,
      markSessionStarted,
      recordSessionStartedAfterPromptCopy,
      startPath,
      state,
      submitFeedback
    ]
  );

  return (
    <LearningPathContext.Provider value={value}>{children}</LearningPathContext.Provider>
  );
}

export function useLearningPath() {
  const value = useContext(LearningPathContext);

  if (!value) {
    throw new Error("useLearningPath must be used within a LearningPathProvider");
  }

  return value;
}

function createBundle({
  domains,
  objectives,
  path,
  sessions
}: {
  domains: LearningDomain[];
  objectives: LearningObjective[];
  path: LearningPath | null;
  sessions: LearningSession[];
}): LearningPathBundle {
  const activeDomain = path
    ? domains.find((domain) => domain.id === path.domain_id) ?? null
    : null;
  const activeObjective = path
    ? objectives.find((objective) => objective.id === path.objective_id) ?? null
    : null;
  const completedSessions = sessions.filter(isSessionComplete);
  const availableSession =
    [...sessions]
      .filter((session) => !isSessionComplete(session) && isSessionVisible(session))
      .sort((left, right) => right.session_number - left.session_number)[0] ?? null;
  const nextAvailableAt =
    [...sessions]
      .filter((session) => !isSessionComplete(session) && !isSessionVisible(session))
      .sort((left, right) => left.session_number - right.session_number)[0]
      ?.available_on ?? null;

  return {
    domains,
    objectives,
    activePath: path,
    activeDomain,
    activeObjective,
    availableSession,
    completedSessions,
    sessions,
    nextAvailableAt
  };
}

function isSessionComplete(session: LearningSession): boolean {
  return Boolean(session.completed_at) || session.status === "completed";
}

function isSessionVisible(session: LearningSession): boolean {
  return (
    (session.generation_status === undefined || session.generation_status === "ready") &&
    ["available", "opened", "started"].includes(session.status)
  );
}

function orderDomains(domains: LearningDomain[]): LearningDomain[] {
  return [...domains].sort((a, b) => {
    const aIndex = learningDomainOrder.indexOf(a.slug as (typeof learningDomainOrder)[number]);
    const bIndex = learningDomainOrder.indexOf(b.slug as (typeof learningDomainOrder)[number]);

    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    }

    return a.position - b.position;
  });
}

function coerceDomain(row: LearningDomain): LearningDomain {
  return row;
}

function coerceObjective(row: LearningObjective): LearningObjective {
  return row;
}

function coercePath(row: LearningPath | null): LearningPath | null {
  return row;
}

function coerceSession(row: LearningSession): LearningSession {
  return {
    ...row,
    objectives_fr: Array.isArray(row.objectives_fr) ? row.objectives_fr : [],
    objectives_en: Array.isArray(row.objectives_en) ? row.objectives_en : []
  };
}

function isLearningHealthcheckReady(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    payload.schema_version === "1.0" &&
    payload.domain_count === 7 &&
    payload.objective_count === 21 &&
    payload.start_rpc_ready === true &&
    payload.session_lifecycle_ready === true
  );
}

async function enqueueLearningOutboxEvent(sessionId: string) {
  const events = await readLearningOutbox();
  const existing = events.find((event) => event.sessionId === sessionId);

  if (existing) {
    return;
  }

  events.push({
    sessionId,
    eventType: "started",
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    lastAttemptAt: null
  });
  await AsyncStorage.setItem(LEARNING_SESSION_OUTBOX_KEY, JSON.stringify(events));
}

async function removeLearningOutboxEvent(sessionId: string) {
  const events = await readLearningOutbox();
  const remaining = events.filter((event) => event.sessionId !== sessionId);

  if (remaining.length === events.length) {
    return;
  }

  await AsyncStorage.setItem(LEARNING_SESSION_OUTBOX_KEY, JSON.stringify(remaining));
}

async function flushLearningOutbox(input: {
  userId: string | null;
  onSynced: (session: LearningSession) => void;
}) {
  if (!input.userId || !supabase) {
    return;
  }

  const events = await readLearningOutbox();
  if (events.length === 0) {
    return;
  }

  const remaining: LearningOutboxEvent[] = [];

  for (const event of events) {
    try {
      const { data, error } = await supabase.rpc("start_learning_session", {
        p_session_id: event.sessionId
      });

      if (error) {
        throw error;
      }

      if (data) {
        input.onSynced(coerceSession(data as LearningSession));
      }
    } catch (error) {
      if (__DEV__) {
        console.warn("[LearningPath] outbox sync failed", error);
      }
      remaining.push({
        ...event,
        attemptCount: event.attemptCount + 1,
        lastAttemptAt: new Date().toISOString()
      });
    }
  }

  await AsyncStorage.setItem(LEARNING_SESSION_OUTBOX_KEY, JSON.stringify(remaining));
}

async function readLearningOutbox(): Promise<LearningOutboxEvent[]> {
  try {
    const value = await AsyncStorage.getItem(LEARNING_SESSION_OUTBOX_KEY);
    if (!value) {
      return [];
    }
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((event): LearningOutboxEvent | null => {
        if (!event || typeof event !== "object") {
          return null;
        }
        const record = event as Partial<LearningOutboxEvent>;
        return typeof record.sessionId === "string" && record.eventType === "started"
          ? {
              sessionId: record.sessionId,
              eventType: "started",
              createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
              attemptCount: Number.isFinite(record.attemptCount) ? Number(record.attemptCount) : 0,
              lastAttemptAt: typeof record.lastAttemptAt === "string" ? record.lastAttemptAt : null
            }
          : null;
      })
      .filter((event): event is LearningOutboxEvent => Boolean(event));
  } catch {
    return [];
  }
}

export async function clearLearningSetupDraft() {
  await AsyncStorage.removeItem("personewsap:learning-setup-draft:v1");
}
