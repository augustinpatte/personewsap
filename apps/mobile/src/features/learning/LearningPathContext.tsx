import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";

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
  getSessionById: (sessionId: string) => LearningSession | undefined;
  reload: () => Promise<void>;
};

const LearningPathContext = createContext<LearningPathContextValue | null>(null);

type LearningPathState = LearningPathBundle & {
  status: "loading" | "ready" | "error";
  source: DataFetchSource;
  error: NormalizedSupabaseError | null;
};

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
    error: null
  });

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
            error: hasSupabaseConfig ? null : getSupabaseConfigError()
          });
        }
        return;
      }

      try {
        const [domainResult, objectiveResult, pathResult] = await Promise.all([
          supabase
            .from("learning_domains")
            .select("id, slug, label_fr, label_en, description_fr, description_en, position")
            .order("position", { ascending: true }),
          supabase
            .from("learning_objectives")
            .select("id, domain_id, slug, label_fr, label_en, description_fr, description_en, position")
            .order("position", { ascending: true }),
          supabase
            .from("user_learning_paths")
            .select(
              "id, user_id, domain_id, objective_id, current_level, target_level, status, created_at, updated_at, archived_at"
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
        if (pathResult.error) {
          throw pathResult.error;
        }

        const path = coercePath(pathResult.data);
        let sessions: LearningSession[] = [];

        if (path) {
          const sessionResult = await supabase
            .from("learning_sessions")
            .select(
              "id, path_id, session_number, title_fr, title_en, summary_fr, summary_en, objectives_fr, objectives_en, prompt_text, status, available_on, opened_at, started_at, completed_at, created_at"
            )
            .eq("path_id", path.id)
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
            error: null
          });
        }
      } catch (error) {
        const normalized = normalizeSupabaseError(error, "Could not load your learning path.");
        const bundle = createBundle({
          domains: mockLearningDomains,
          objectives: mockLearningObjectives,
          path: null,
          sessions: []
        });

        if (isActive()) {
          setState({
            ...bundle,
            status: "error",
            source: "mock",
            error: normalized
          });
        }
      }
    },
    [authStatus, user?.id]
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
        const { error } = await supabase.rpc("start_learning_path", {
          p_domain_id: domainId,
          p_objective_id: objectiveId,
          p_current_level: currentLevel,
          p_target_level: targetLevel
        });

        if (error) {
          throw error;
        }

        trackAnalyticsEvent("learning_path_started", {
          language: profileLanguage ?? undefined
        });

        await load();
        return { ok: true, error: null };
      } catch (error) {
        return {
          ok: false,
          error: normalizeSupabaseError(error, "Could not create your learning path.")
        };
      }
    },
    [load, profileLanguage, user?.id]
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

  const value = useMemo<LearningPathContextValue>(
    () => ({
      ...state,
      markSessionOpened,
      markSessionStarted,
      startPath,
      submitFeedback,
      getSessionById: (sessionId) => state.sessions.find((session) => session.id === sessionId),
      reload: () => load()
    }),
    [load, markSessionOpened, markSessionStarted, startPath, state, submitFeedback]
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
    sessions.find((session) => !isSessionComplete(session) && isSessionVisible(session)) ?? null;
  const nextAvailableAt =
    sessions.find((session) => !isSessionComplete(session) && !isSessionVisible(session))
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
  return ["available", "opened", "started"].includes(session.status);
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
