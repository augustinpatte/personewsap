import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  getLearningSetupDraftKey,
  LEARNING_SETUP_DRAFT_KEY_V1
} from "./learningSetupDraft";
import {
  getLearningSessionsForPath,
  selectLatestLearningSessionForDrop
} from "./learningPathState";
import {
  flushLearningOutboxEvents,
  readLearningOutbox,
  removeLearningOutboxEvent,
  resolveLearningFeedbackSyncOutcome,
  shouldCompleteLearningSessionLocally,
  upsertLearningOutboxEvent,
  writeLearningOutbox,
  type LearningOutboxSyncFailure,
  type LearningOutboxEvent
} from "./learningOutbox";
import { fetchLearningCatalogSteps } from "./catalog/catalogData";
import { prepareLearningSession } from "./catalog/sessionPrompt";
import {
  countUsedStepKeys,
  pickNextLearningStep,
  resolveLearningAdaptationMode
} from "./catalog/stepSelection";
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
  LearningFeedbackRatings,
  LearningObjective,
  LearningPath,
  LearningPathBundle,
  LearningSession,
  LearningTargetLevel
} from "./learningTypes";

export {
  getHistoricalLearningPaths,
  getLearningSessionsForPath,
  selectLatestLearningSessionForDrop
} from "./learningPathState";

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
  ) => Promise<{ ok: boolean; syncPending: boolean; error: NormalizedSupabaseError | null }>;
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
  /**
   * Materialise the next session of the active path, on the reader's command.
   * Progress is never bound to the edition calendar: a reader can run as many
   * sessions in a row as they like, but only ever one tap at a time.
   */
  advanceLearningPath: () => Promise<{
    ok: boolean;
    /** The session to open, when one is ready. */
    session: LearningSession | null;
    /** True when the curriculum has no step left for this path. */
    pathCompleted: boolean;
    error: NormalizedSupabaseError | null;
  }>;
  /** True while an advance is in flight, so the CTA can lock itself. */
  advancing: boolean;
  getSessionById: (sessionId: string) => LearningSession | undefined;
  loadSessionsForPath: (pathId: string) => Promise<LearningSession[]>;
  reload: () => Promise<void>;
};

const LearningPathContext = createContext<LearningPathContextValue | null>(null);

const learningPathSelect =
  "id, user_id, domain_id, objective_id, current_level, target_level, language, status, created_at, updated_at, archived_at, completed_at";

type LearningPathState = LearningPathBundle & {
  status: "loading" | "ready" | "error";
  source: DataFetchSource;
  error: NormalizedSupabaseError | null;
  learningPathEnabled: boolean;
  learningPathChoiceCompleted: boolean;
};

const initialBundle = createBundle({
  domains: mockLearningDomains,
  objectives: mockLearningObjectives,
  learningPaths: [],
  activePath: null,
  latestCompletedPath: null,
  sessions: []
});

export function LearningPathProvider({ children }: PropsWithChildren) {
  const { profileLanguage, status: authStatus, user } = useAuth();
  const [advancing, setAdvancing] = useState(false);
  // Ref, not state: the guard must reject a second tap within the same tick,
  // before React has re-rendered with advancing=true.
  const advanceInFlightRef = useRef(false);
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
          learningPaths: current.learningPaths,
          activePath: current.activePath,
          latestCompletedPath: current.latestCompletedPath,
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
          learningPaths: hasSupabaseConfig ? [] : [mockLearningPath],
          activePath: hasSupabaseConfig ? null : mockLearningPath,
          latestCompletedPath: null,
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
        // Draining the outbox is best effort and must not decide whether the
        // path loads: offline, it simply stays queued for the next foreground.
        try {
          await flushLearningOutbox({
            userId: user.id,
            onSynced: (session) => updateSessionLocally(session.id, session)
          });
        } catch (flushError) {
          if (__DEV__) {
            console.info("[LearningPath] outbox flush deferred", flushError);
          }
        }

        // One round trip for everything the boot needs: the schema check runs
        // beside the reads instead of gating them, which is what turned a cold
        // start into three serial waits on a slow connection. Only what the
        // routing and the Parcours header need is fetched here — the
        // curriculum catalog stays on-demand, loaded when a session is
        // actually prepared.
        const [
          healthResult,
          domainResult,
          objectiveResult,
          preferencesResult,
          pathResult
        ] = await Promise.all([
          supabase.rpc("learning_paths_healthcheck"),
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
            .select(learningPathSelect)
            .eq("user_id", user.id)
            .in("status", ["active", "completed", "archived"])
            .order("created_at", { ascending: false })
        ]);

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

        const paths = (pathResult.data ?? []).map(coercePath).filter((path): path is LearningPath => Boolean(path));
        const activePath = paths.find((candidate) => candidate.status === "active") ?? null;
        const latestCompletedPath = paths.find((candidate) => candidate.status === "completed") ?? null;
        const displayPath = activePath ?? latestCompletedPath;
        let sessions: LearningSession[] = [];

        if (displayPath) {
          const sessionResult = await supabase
            .from("learning_sessions")
            .select(
              "id, path_id, daily_drop_id, curriculum_step_key, skipped_step_key, session_number, adaptation_mode, language, title_fr, title_en, summary_fr, summary_en, objectives_fr, objectives_en, prompt_text, generation_status, status, available_on, opened_at, started_at, completed_at, created_at"
            )
            .eq("path_id", displayPath.id)
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
          learningPaths: paths,
          activePath,
          latestCompletedPath,
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
            ...createBundle({
              domains: [],
              objectives: [],
              learningPaths: [],
              activePath: null,
              latestCompletedPath: null,
              sessions: []
            }),
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
    // load() normalises every failure into state; the catch guarantees a boot
    // with no network cannot surface as an unhandled rejection.
    void load(() => isMounted).catch((error: unknown) => {
      if (__DEV__) {
        console.info("[LearningPath] initial load failed", error);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [load]);

  /**
   * Materialise exactly one session for `path`, from the deterministic
   * curriculum catalog. No LLM call: the step, its title and its prompt all
   * come from content/learning-paths/v1 through the catalog mirror.
   *
   * Kept independent of the provider's loaded state so it can serve both the
   * reader tapping "next session" and the moment a path is created — where the
   * state does not know about the new path yet. The server owns idempotence:
   * create_next_learning_session takes an advisory lock and returns the session
   * already waiting instead of making a second one.
   */
  const prepareNextSessionForPath = useCallback(
    async (input: {
      path: LearningPath;
      sessions: LearningSession[];
    }): Promise<{
      ok: boolean;
      session: LearningSession | null;
      pathCompleted: boolean;
      error: NormalizedSupabaseError | null;
    }> => {
      const { path, sessions } = input;

      if (!supabase || !user?.id) {
        return {
          ok: false,
          session: null,
          pathCompleted: false,
          error: normalizeSupabaseError(
            getSupabaseConfigError(),
            "Your learning path is unavailable."
          )
        };
      }

      const catalog = await fetchLearningCatalogSteps(path.domain_id);

      if (catalog.length === 0) {
        return {
          ok: false,
          session: null,
          pathCompleted: false,
          error: normalizeSupabaseError(
            { code: "learning_catalog_unavailable", message: "Curriculum unavailable." },
            "Your next session could not be prepared."
          )
        };
      }

      const orderedSessions = [...sessions].sort(
        (left, right) => left.session_number - right.session_number
      );
      const lastSession = orderedSessions[orderedSessions.length - 1] ?? null;
      const feedback = lastSession
        ? await fetchSessionFeedback(user.id, lastSession.id)
        : null;
      const adaptationMode = resolveLearningAdaptationMode(
        feedback,
        lastSession?.adaptation_mode === "reinforce"
      );
      const selection = pickNextLearningStep({
        catalog,
        domainId: path.domain_id,
        objectiveId: path.objective_id,
        currentLevel: path.current_level,
        targetLevel: path.target_level,
        usedStepKeys: countUsedStepKeys(orderedSessions),
        adaptationMode,
        lastStepKey: lastSession?.curriculum_step_key ?? null
      });

      // Every step up to the target level has been delivered: the path is done.
      if (selection.status === "completed") {
        await supabase
          .from("user_learning_paths")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", path.id)
          .eq("user_id", user.id)
          .eq("status", "active");

        return { ok: true, session: null, pathCompleted: true, error: null };
      }

      const prepared = prepareLearningSession({
        step: selection.step,
        // The session is authored in the path's current language; sessions
        // already delivered keep the language they were written in.
        language: path.language === "fr" ? "fr" : "en",
        repetitionIndex: selection.repetitionIndex,
        adaptationMode,
        skippedStepKey: selection.skippedStepKey
      });

      const { data, error } = await supabase.rpc("create_next_learning_session", {
        p_curriculum_step_key: prepared.curriculumStepKey,
        p_skipped_step_key: prepared.skippedStepKey,
        p_adaptation_mode: prepared.adaptationMode,
        p_title_fr: prepared.titleFr,
        p_title_en: prepared.titleEn,
        p_summary_fr: prepared.summaryFr,
        p_summary_en: prepared.summaryEn,
        p_objectives_fr: prepared.objectivesFr,
        p_objectives_en: prepared.objectivesEn,
        p_prompt_text: prepared.promptText
      });

      if (error) {
        throw error;
      }

      const session = data ? coerceSession(data as LearningSession) : null;

      return { ok: Boolean(session), session, pathCompleted: false, error: null };
    },
    [user?.id]
  );

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

        const { data: verifiedPath, error: verifyError } = await supabase
          .from("user_learning_paths")
          .select(learningPathSelect)
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

        // Creating a path is already the reader's explicit decision, so the
        // first session is prepared with it: they land on Parcours with
        // "Session 1" and its title already there, not on an empty card. Only
        // this one — every later session still waits for an explicit tap.
        //
        // Failing here is not a failed creation: the path exists, and the
        // Parcours screen offers the same preparation again on its CTA.
        try {
          await prepareNextSessionForPath({ path: verifiedPath, sessions: [] });
        } catch (firstSessionError) {
          if (__DEV__) {
            console.info(
              "[LearningPath] first session deferred to the Parcours screen",
              firstSessionError
            );
          }
        }

        await load();

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
    [load, prepareNextSessionForPath, profileLanguage, user?.id]
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
        await clearLearningSetupDraftForUser(user.id);
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

  const advanceLearningPath = useCallback<LearningPathContextValue["advanceLearningPath"]>(
    async () => {
      // Guard first: a double tap must never create two sessions, and must
      // never fire two requests.
      if (advanceInFlightRef.current) {
        return { ok: true, session: null, pathCompleted: false, error: null };
      }

      const path = state.activePath;

      if (!supabase || !user?.id || !path) {
        return {
          ok: false,
          session: null,
          pathCompleted: false,
          error: normalizeSupabaseError(
            getSupabaseConfigError(),
            "Your learning path is unavailable."
          )
        };
      }

      // A session already waiting is the answer: open it instead of making one.
      // Same selection the UI shows, so the CTA and this action never disagree.
      const waiting = state.availableSession;

      if (waiting && !isSessionComplete(waiting)) {
        return { ok: true, session: waiting, pathCompleted: false, error: null };
      }

      advanceInFlightRef.current = true;
      setAdvancing(true);

      try {
        const result = await prepareNextSessionForPath({
          path,
          sessions: state.sessions
        });

        if (!result.ok && result.error) {
          return result;
        }

        await load();

        if (result.pathCompleted) {
          return result;
        }

        trackAnalyticsEvent("learning_session_started", {
          language: profileLanguage ?? undefined
        });

        return result;
      } catch (error) {
        if (__DEV__) {
          console.warn("[LearningPath] advanceLearningPath failed", error);
        }

        return {
          ok: false,
          session: null,
          pathCompleted: false,
          error: normalizeSupabaseError(error, "Your next session could not be prepared.")
        };
      } finally {
        advanceInFlightRef.current = false;
        setAdvancing(false);
      }
    },
    [
      load,
      prepareNextSessionForPath,
      profileLanguage,
      state.activePath,
      state.availableSession,
      state.sessions,
      user?.id
    ]
  );

  const submitFeedback = useCallback<LearningPathContextValue["submitFeedback"]>(
    async (sessionId, ratings) => {
      if (!supabase || !user?.id) {
        return {
          ok: false,
          syncPending: false,
          error: normalizeSupabaseError(getSupabaseConfigError(), "Feedback is unavailable.")
        };
      }

      if (!areLearningFeedbackRatingsValid(ratings)) {
        return {
          ok: false,
          syncPending: false,
          error: normalizeSupabaseError(
            { code: "invalid_learning_feedback", message: "Feedback ratings must be integers from 1 to 5." },
            "Feedback could not be saved."
          )
        };
      }

      const now = new Date().toISOString();

      try {
        await enqueueLearningOutboxEvent(user.id, {
          sessionId,
          eventType: "feedback",
          ratings,
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null
        });
      } catch (error) {
        if (__DEV__) {
          console.warn("[LearningPath] feedback outbox write failed", error);
        }
        return {
          ok: false,
          syncPending: false,
          error: normalizeSupabaseError(error, "Feedback could not be saved.")
        };
      }

      let flushResult: { failures: LearningOutboxSyncFailure[] };
      let feedbackStillLocal = true;

      try {
        flushResult = await flushLearningOutbox({
          userId: user.id,
          onSynced: (session) => updateSessionLocally(session.id, session)
        });
        const remainingEvents = await readLearningOutbox(AsyncStorage, user.id);
        feedbackStillLocal = remainingEvents.some(
          (event) => event.sessionId === sessionId && event.eventType === "feedback"
        );
      } catch (error) {
        return {
          ok: false,
          syncPending: false,
          error: normalizeSupabaseError(error, "Feedback could not be saved.")
        };
      }

      const blockingFailure = getLearningFeedbackBlockingFailure(flushResult.failures, sessionId);
      const syncOutcome = resolveLearningFeedbackSyncOutcome({
        feedbackStillLocal,
        blockingFailure
      });

      if (shouldCompleteLearningSessionLocally(syncOutcome)) {
        updateSessionLocally(sessionId, {
          completed_at: now,
          started_at: state.sessions.find((session) => session.id === sessionId)?.started_at ?? now,
          status: "completed"
        });
      }

      if (syncOutcome.ok && syncOutcome.syncPending) {
        return { ok: true, syncPending: true, error: null };
      }

      if (syncOutcome.ok) {
        trackAnalyticsEvent("learning_feedback_submitted", {
          language: profileLanguage ?? undefined
        });
        await load();
        return { ok: true, syncPending: false, error: null };
      }

      return {
        ok: false,
        syncPending: false,
        error: normalizeSupabaseError(
          blockingFailure?.error ?? { code: "learning_feedback_sync_failed" },
          "Feedback could not be saved."
        )
      };
    },
    [load, profileLanguage, state.sessions, updateSessionLocally, user?.id]
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
        await removeLearningOutboxEventForUser(user?.id ?? null, sessionId, "started");
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
        await removeLearningOutboxEventForUser(user.id, sessionId, "started");
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
      await enqueueLearningOutboxEvent(user?.id ?? null, {
        sessionId,
        eventType: "started",
        createdAt: new Date().toISOString(),
        attemptCount: 0,
        lastAttemptAt: null
      });
      const result = await markSessionStarted(sessionId);
      return {
        ...result,
        syncPending: !result.ok
      };
    },
    [markSessionStarted, user?.id]
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void flushLearningOutbox({
          userId: user?.id ?? null,
          onSynced: (session) => updateSessionLocally(session.id, session)
        }).catch((error: unknown) => {
          // Returning to the app with no network is expected: the queue keeps
          // its events for the next attempt.
          if (__DEV__) {
            console.info("[LearningPath] outbox flush deferred", error);
          }
        });
      }
    });

    return () => subscription.remove();
  }, [updateSessionLocally, user?.id]);

  const loadSessionsForPath = useCallback<LearningPathContextValue["loadSessionsForPath"]>(
    async (pathId) => {
      if (!pathId) {
        return [];
      }

      if (!supabase || state.source === "mock") {
        return getLearningSessionsForPath(mockLearningSessions, pathId);
      }

      const { data, error } = await supabase
        .from("learning_sessions")
        .select(
          "id, path_id, daily_drop_id, curriculum_step_key, skipped_step_key, session_number, adaptation_mode, language, title_fr, title_en, summary_fr, summary_en, objectives_fr, objectives_en, prompt_text, generation_status, status, available_on, opened_at, started_at, completed_at, created_at"
        )
        .eq("path_id", pathId)
        .eq("generation_status", "ready")
        .order("session_number", { ascending: true });

      if (error) {
        throw error;
      }

      return (data ?? []).map(coerceSession);
    },
    [state.source]
  );

  const value = useMemo<LearningPathContextValue>(
    () => ({
      ...state,
      advanceLearningPath,
      advancing,
      disableLearningPath,
      markSessionOpened,
      markSessionStarted,
      recordSessionStartedAfterPromptCopy,
      startPath,
      submitFeedback,
      getSessionById: (sessionId) => state.sessions.find((session) => session.id === sessionId),
      loadSessionsForPath,
      reload: () => load()
    }),
    [
      advanceLearningPath,
      advancing,
      disableLearningPath,
      loadSessionsForPath,
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
  learningPaths,
  activePath,
  latestCompletedPath,
  sessions
}: {
  domains: LearningDomain[];
  objectives: LearningObjective[];
  learningPaths: LearningPath[];
  activePath: LearningPath | null;
  latestCompletedPath: LearningPath | null;
  sessions: LearningSession[];
}): LearningPathBundle {
  const displayPath = activePath ?? latestCompletedPath;
  const activeDomain = activePath
    ? domains.find((domain) => domain.id === activePath.domain_id) ?? null
    : null;
  const activeObjective = activePath
    ? objectives.find((objective) => objective.id === activePath.objective_id) ?? null
    : null;
  const displayDomain = displayPath
    ? domains.find((domain) => domain.id === displayPath.domain_id) ?? null
    : null;
  const displayObjective = displayPath
    ? objectives.find((objective) => objective.id === displayPath.objective_id) ?? null
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
    learningPaths,
    activePath,
    latestCompletedPath,
    displayPath,
    activeDomain,
    activeObjective,
    displayDomain,
    displayObjective,
    availableSession,
    completedSessions,
    sessions,
    nextAvailableAt,
    getSessionForDrop: (dropId) => selectLatestLearningSessionForDrop(sessions, dropId)
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
    language: row.language === "fr" ? "fr" : "en",
    objectives_fr: Array.isArray(row.objectives_fr) ? row.objectives_fr : [],
    objectives_en: Array.isArray(row.objectives_en) ? row.objectives_en : []
  };
}

export function isLearningHealthcheckReady(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    payload.schema_version === "1.1" &&
    payload.ready === true &&
    payload.domain_count === 7 &&
    payload.objective_count === 21 &&
    payload.start_rpc_ready === true &&
    payload.session_lifecycle_ready === true &&
    payload.columns_ready === true &&
    payload.functions_ready === true &&
    payload.constraints_ready === true &&
    payload.indexes_ready === true &&
    payload.rls_ready === true
  );
}

/**
 * Ratings the reader gave on one session, used to adapt the next one. RLS
 * scopes learning_session_feedback to its owner, and the explicit user filter
 * keeps that intent visible at the call site.
 */
async function fetchSessionFeedback(
  userId: string,
  sessionId: string
): Promise<{
  comprehensionRating: number;
  explainabilityRating: number;
  interestRating: number;
  difficultyRating: number;
} | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("learning_session_feedback")
    .select("comprehension_rating,explainability_rating,interest_rating,difficulty_rating")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    comprehensionRating: data.comprehension_rating,
    explainabilityRating: data.explainability_rating,
    interestRating: data.interest_rating,
    difficultyRating: data.difficulty_rating
  };
}

async function enqueueLearningOutboxEvent(userId: string | null, event: LearningOutboxEvent) {
  const events = await readLearningOutbox(AsyncStorage, userId);
  await writeLearningOutbox(AsyncStorage, userId, upsertLearningOutboxEvent(events, event));
}

async function removeLearningOutboxEventForUser(
  userId: string | null,
  sessionId: string,
  eventType?: LearningOutboxEvent["eventType"]
) {
  const events = await readLearningOutbox(AsyncStorage, userId);
  await writeLearningOutbox(AsyncStorage, userId, removeLearningOutboxEvent(events, sessionId, eventType));
}

async function flushLearningOutbox(input: {
  userId: string | null;
  onSynced: (session: LearningSession) => void;
}): Promise<{ failures: LearningOutboxSyncFailure[] }> {
  if (!input.userId || !supabase) {
    return { failures: [] };
  }
  const client = supabase;

  const events = await readLearningOutbox(AsyncStorage, input.userId);
  if (events.length === 0) {
    return { failures: [] };
  }

  const result = await flushLearningOutboxEvents(events, {
    now: () => new Date().toISOString(),
    startSession: async (sessionId) => {
      const { data, error } = await client.rpc("start_learning_session", {
        p_session_id: sessionId
      });

      if (error) {
        throw error;
      }

      return data && typeof data === "object" ? coerceSession(data as LearningSession) : null;
    },
    submitFeedback: async (sessionId, ratings) => {
      const { data, error } = await client.rpc("submit_learning_session_feedback", {
        p_session_id: sessionId,
        p_comprehension_rating: ratings.comprehension,
        p_explainability_rating: ratings.explainability,
        p_interest_rating: ratings.interest,
        p_difficulty_rating: ratings.difficulty
      });

      if (error) {
        throw error;
      }

      return data && typeof data === "object" ? coerceSession(data as LearningSession) : null;
    }
  });

  for (const session of result.syncedSessions) {
    input.onSynced(session);
  }

  for (const failure of result.failures) {
    if (__DEV__) {
      console.warn("[LearningPath] outbox sync failed", failure.error);
    }
  }

  await writeLearningOutbox(AsyncStorage, input.userId, result.remaining);
  return { failures: result.failures };
}

export async function clearLearningSetupDraft() {
  await clearLearningSetupDraftForUser(null);
}

async function clearLearningSetupDraftForUser(userId: string | null) {
  await AsyncStorage.removeItem(LEARNING_SETUP_DRAFT_KEY_V1);
  await AsyncStorage.removeItem(getLearningSetupDraftKey(userId));
}

function areLearningFeedbackRatingsValid(ratings: LearningFeedbackRatings): ratings is {
  comprehension: number;
  explainability: number;
  interest: number;
  difficulty: number;
} {
  return (
    isLearningFeedbackRating(ratings.comprehension) &&
    isLearningFeedbackRating(ratings.explainability) &&
    isLearningFeedbackRating(ratings.interest) &&
    isLearningFeedbackRating(ratings.difficulty)
  );
}

function isLearningFeedbackRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

function getLearningFeedbackBlockingFailure(
  failures: LearningOutboxSyncFailure[],
  sessionId: string
): LearningOutboxSyncFailure | null {
  return (
    failures.find(
      (failure) =>
        failure.event.sessionId === sessionId &&
        (failure.event.eventType === "feedback" || failure.event.eventType === "started")
    ) ?? null
  );
}
