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
import type { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";

import {
  applySupabaseAuthUrl,
  clearLocalAuthSession,
  getAuthSession,
  getValidatedAuthSession,
  getSupabaseConfigError,
  hasSupabaseConfig,
  isAuthSessionError,
  normalizeSupabaseError,
  signOut as signOutFromSupabase,
  supabase,
  supabaseConfigDiagnostics,
  type NormalizedSupabaseError
} from "../../lib/supabase";
import { disablePushNotificationsForUser } from "../notifications/pushNotificationPreferences";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { rememberBootLanguage } from "../../lib/useBootLanguage";
import type { Language } from "../../types/domain";
import {
  moduleFlagsFor,
  moduleFlagsFromPreferencesRow,
  type ModuleFlags,
  type OwnedModuleFlags
} from "../preferences/moduleFlags";
import { redactIdentifier } from "../../lib/redactIdentifier";

/**
 * Where the reader stands, as far as routing is concerned.
 *
 *   loading         the first resolution (or an explicit refresh) is running
 *   signedOut       no session, or the session was proven invalid
 *   needsOnboarding a SUCCESSFUL read proved the profile is incomplete
 *   ready           a successful read proved the profile is complete
 *   profileError    there is a session, but its profile could not be read
 *                   (offline, timeout, 5xx). Retryable. It is never treated as
 *                   "incomplete": that would send an onboarded reader back into
 *                   onboarding, and saving it again would overwrite their
 *                   preferences.
 */
export type AuthStatus = "loading" | "signedOut" | "needsOnboarding" | "ready" | "profileError";

type SignUpParams = {
  email: string;
  password: string;
};

type SignInParams = {
  email: string;
  password: string;
};

type AuthActionResult = {
  error: NormalizedSupabaseError | null;
  needsEmailConfirmation?: boolean;
};

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  error: NormalizedSupabaseError | null;
  profileCompleted: boolean;
  profileLanguage: Language | null;
  /**
   * The reader's module switches, read with the profile. Null until a read for
   * THIS user has succeeded — never another account's. Module tabs read this
   * from memory; nothing re-queries preferences on focus.
   */
  moduleFlags: ModuleFlags | null;
  isConfigured: boolean;
  applyProfileLanguage: (language: Language) => void;
  /** Replace the held flags after a save that wrote them (Settings, Learning). */
  applyModuleFlags: (patch: Partial<ModuleFlags>) => void;
  /**
   * Full, blocking re-resolution: validates the session with the auth server,
   * shows the launch screen while it runs, and lands on profileError if the
   * profile cannot be read. For explicit retries and for moments that must
   * re-route (onboarding finished, password reset).
   */
  refreshAuthState: () => Promise<void>;
  /**
   * Quiet re-read of the profile after the reader changed it (Settings). Never
   * sets `loading`, so nothing remounts; a failed read keeps the current state
   * and is returned to the caller instead.
   */
  refreshProfile: () => Promise<NormalizedSupabaseError | null>;
  signInWithEmail: (params: SignInParams) => Promise<AuthActionResult>;
  signUpWithEmail: (params: SignUpParams) => Promise<AuthActionResult>;
  signOut: () => Promise<AuthActionResult>;
};

type ResolutionMode = "blocking" | "background";

type ProfileResolution =
  | { kind: "resolved"; completed: boolean; language: Language | null; moduleFlags: ModuleFlags }
  | { kind: "authError"; error: NormalizedSupabaseError }
  | { kind: "error"; error: NormalizedSupabaseError };

const AuthContext = createContext<AuthContextValue | null>(null);

function getLocalTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function classifyProfileError(error: NormalizedSupabaseError): ProfileResolution {
  return isAuthSessionError(error) ? { kind: "authError", error } : { kind: "error", error };
}

/**
 * Everything routing needs to know about a signed-in reader, in one round trip.
 *
 * The four reads are independent, so they run in parallel instead of one after
 * another. A missing profile is created here (the only extra request, and only
 * for a brand-new account); a new account cannot hold preferences yet, because
 * every preference table references profiles, so it is incomplete by
 * definition.
 *
 * Any read error is returned as an error. It is never folded into "incomplete".
 */
async function readProfileResolution(user: User): Promise<ProfileResolution> {
  if (!supabase) {
    return { kind: "error", error: getAuthConfigError() };
  }

  try {
    const [profileResult, preferencesResult, topicResult, miniCaseTopicResult] = await Promise.all([
      supabase.from("profiles").select("id, language").eq("id", user.id).maybeSingle(),
      supabase
        .from("user_preferences")
        .select(
          "user_id, newsletter_enabled, business_stories_enabled, mini_cases_enabled, learning_path_enabled, learning_path_choice_completed"
        )
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("user_topic_preferences")
        .select("topic_id")
        .eq("user_id", user.id)
        .eq("enabled", true)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("user_mini_case_topic_preferences")
        .select("topic_id")
        .eq("user_id", user.id)
        .eq("enabled", true)
        .limit(1)
        .maybeSingle()
    ]);

    const readError =
      profileResult.error ??
      preferencesResult.error ??
      topicResult.error ??
      miniCaseTopicResult.error;

    if (readError) {
      logProfileProof("profile_read_failed", {
        reason: "supabase_error",
        user_id: redactIdentifier(user.id)
      });

      return classifyProfileError(
        normalizeSupabaseError(readError, "Could not check onboarding status.")
      );
    }

    const profile = profileResult.data;

    if (!profile) {
      const { error: insertError } = await supabase.from("profiles").insert({
        id: user.id,
        email: user.email ?? "",
        language: "en",
        timezone: getLocalTimezone()
      });

      // 23505: a concurrent resolution created it first. Same outcome.
      if (insertError && insertError.code !== "23505") {
        logProfileProof("profile_save_failed", {
          reason: "supabase_error",
          user_id: redactIdentifier(user.id)
        });

        return classifyProfileError(
          normalizeSupabaseError(insertError, "Could not create your mobile profile.")
        );
      }

      logProfileProof("profile_saved", {
        language: "en",
        user_id: redactIdentifier(user.id)
      });

      return {
        kind: "resolved",
        completed: false,
        language: "en",
        moduleFlags: moduleFlagsFromPreferencesRow(null)
      };
    }

    const preferences = preferencesResult.data;
    const newsletterReady = preferences?.newsletter_enabled === false || Boolean(topicResult.data);
    const miniCaseReady =
      preferences?.mini_cases_enabled === false || Boolean(miniCaseTopicResult.data);
    const learningChoiceReady = preferences?.learning_path_choice_completed === true;

    return {
      kind: "resolved",
      completed: Boolean(preferences && newsletterReady && miniCaseReady && learningChoiceReady),
      language: profile.language ?? null,
      moduleFlags: moduleFlagsFromPreferencesRow(preferences)
    };
  } catch (error) {
    return classifyProfileError(normalizeSupabaseError(error, "Could not check onboarding status."));
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [profileCompleted, setProfileCompleted] = useState(false);
  const [profileLanguage, setProfileLanguage] = useState<Language | null>(null);
  const [ownedModuleFlags, setOwnedModuleFlags] = useState<OwnedModuleFlags | null>(null);
  const [error, setError] = useState<NormalizedSupabaseError | null>(null);
  const authApplySequenceRef = useRef(0);
  // The user whose profile was last read SUCCESSFULLY. Auth events for that same
  // user (token refresh, a re-emitted sign-in) only carry a new token.
  const resolvedUserIdRef = useRef<string | null>(null);
  // One resolution per user at a time: the explicit bootstrap, a sign-in and the
  // auth event that follows it all ask about the same reader.
  const inFlightRef = useRef<{
    userId: string;
    promise: Promise<NormalizedSupabaseError | null>;
  } | null>(null);

  const resolveSession = useCallback(
    async (nextSession: Session | null, mode: ResolutionMode) => {
      const sequence = authApplySequenceRef.current + 1;
      authApplySequenceRef.current = sequence;
      const isCurrent = () => authApplySequenceRef.current === sequence;

      setSession(nextSession);

      if (!nextSession?.user) {
        resolvedUserIdRef.current = null;
        setProfileCompleted(false);
        setProfileLanguage(null);
        setOwnedModuleFlags(null);
        setStatus("signedOut");
        return null;
      }

      const user = nextSession.user;
      const resolution = await readProfileResolution(user);

      if (!isCurrent()) {
        return null;
      }

      if (resolution.kind === "authError") {
        await clearLocalAuthSession();
        if (!isCurrent()) {
          return null;
        }
        resolvedUserIdRef.current = null;
        setSession(null);
        setProfileCompleted(false);
        setProfileLanguage(null);
        setOwnedModuleFlags(null);
        setError(resolution.error);
        setStatus("signedOut");
        return resolution.error;
      }

      if (resolution.kind === "error") {
        logAuthDebug("profile_resolution_failed", resolution.error);

        // A quiet refresh for a reader we already know: keep what we know. The
        // session, the route and every loaded screen stay exactly as they were.
        if (mode === "background" && resolvedUserIdRef.current === user.id) {
          return resolution.error;
        }

        // Nothing usable is known yet (or the caller asked to know for sure):
        // stop on a retryable state. Never needsOnboarding, never signed out.
        setError(resolution.error);
        setStatus("profileError");
        return resolution.error;
      }

      resolvedUserIdRef.current = user.id;
      setError(null);
      setProfileCompleted(resolution.completed);
      setProfileLanguage(resolution.language);
      setOwnedModuleFlags({ userId: user.id, flags: resolution.moduleFlags });
      setStatus(resolution.completed ? "ready" : "needsOnboarding");
      return null;
    },
    []
  );

  const requestResolution = useCallback(
    (
      nextSession: Session | null,
      mode: ResolutionMode,
      { reuseInFlight = true }: { reuseInFlight?: boolean } = {}
    ) => {
      const userId = nextSession?.user?.id ?? null;
      const inFlight = inFlightRef.current;

      if (reuseInFlight && userId && inFlight && inFlight.userId === userId) {
        setSession(nextSession);
        return inFlight.promise;
      }

      const promise: Promise<NormalizedSupabaseError | null> = resolveSession(
        nextSession,
        mode
      ).finally(() => {
        if (inFlightRef.current?.promise === promise) {
          inFlightRef.current = null;
        }
      });

      inFlightRef.current = userId ? { userId, promise } : null;
      return promise;
    },
    [resolveSession]
  );

  // Single source of truth for the app's UI language. Updating it here re-renders
  // every screen that reads `profileLanguage`, so a language change takes effect
  // immediately app-wide without a reload. Persistence to profiles.language is the
  // caller's responsibility so the choice survives a restart.
  const applyProfileLanguage = useCallback((language: Language) => {
    setProfileLanguage(language);
  }, []);

  const applyModuleFlags = useCallback((patch: Partial<ModuleFlags>) => {
    setOwnedModuleFlags((current) =>
      current ? { userId: current.userId, flags: { ...current.flags, ...patch } } : current
    );
  }, []);

  const refreshAuthState = useCallback(async () => {
    setStatus("loading");

    const validated = await getValidatedAuthSession();
    let nextSession = validated.data;

    if (validated.error) {
      // Only a session the auth server rejected, or a build without a backend,
      // ends the session. Any other validation failure (a 5xx from the auth
      // server) keeps the stored session and lets the profile read decide.
      const sessionIsInvalid =
        isAuthSessionError(validated.error) || validated.error.code === "missing_supabase_config";
      const stored = sessionIsInvalid ? null : (await getAuthSession()).data;

      if (!stored) {
        resolvedUserIdRef.current = null;
        setError(validated.error);
        setSession(null);
        setProfileCompleted(false);
        setProfileLanguage(null);
        setOwnedModuleFlags(null);
        setStatus("signedOut");
        return;
      }

      nextSession = stored;
    }

    setError(null);
    // Always a fresh, blocking resolution: this call set `loading`, so it must be
    // the one that settles it. Joining a background read that keeps the previous
    // state on failure would leave the app on the launch screen.
    await requestResolution(nextSession, "blocking", { reuseInFlight: false });
  }, [requestResolution]);

  const refreshProfile = useCallback(async () => {
    const stored = await getAuthSession();

    if (!stored.data?.user) {
      return stored.error;
    }

    return requestResolution(stored.data, "background");
  }, [requestResolution]);

  const signInWithEmail = useCallback(
    async ({ email, password }: SignInParams) => {
      if (!supabase) {
        const configError = getAuthConfigError();
        setError(configError);
        logAuthDebug("login_config_error", configError);
        return { error: configError };
      }

      logAuthDebug("login_started");

      try {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });

        if (signInError) {
          const normalizedError = normalizeSupabaseError(signInError);
          setError(normalizedError);
          logAuthDebug("login_error", normalizedError);
          return { error: normalizedError };
        }

        setError(null);
        const sessionApplyError = await requestResolution(data.session, "blocking");
        if (sessionApplyError) {
          logAuthDebug("login_profile_state_error", sessionApplyError);
          return { error: sessionApplyError };
        }
        trackAnalyticsEvent("auth_signed_in");
        logAuthDebug("login_success");

        return { error: null };
      } catch (error) {
        const normalizedError = normalizeSupabaseError(error, "Could not log in.");
        setError(normalizedError);
        logAuthDebug("login_exception", normalizedError);
        return { error: normalizedError };
      }
    },
    [requestResolution]
  );

  const signUpWithEmail = useCallback(
    async ({ email, password }: SignUpParams) => {
      if (!supabase) {
        const configError = getAuthConfigError();
        setError(configError);
        logAuthDebug("signup_config_error", configError);
        return { error: configError };
      }

      logAuthDebug("signup_started");

      try {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password
        });

        if (signUpError) {
          const normalizedError = normalizeSupabaseError(signUpError);
          setError(normalizedError);
          logAuthDebug("signup_error", normalizedError);
          return { error: normalizedError };
        }

        setError(null);
        const sessionApplyError = await requestResolution(data.session, "blocking");
        if (sessionApplyError) {
          logAuthDebug("signup_profile_state_error", sessionApplyError);
          return { error: sessionApplyError };
        }
        if (data.session) {
          trackAnalyticsEvent("auth_signed_in");
        }
        logAuthDebug(data.session ? "signup_success" : "signup_email_confirmation_required");

        return {
          error: null,
          needsEmailConfirmation: !data.session
        };
      } catch (error) {
        const normalizedError = normalizeSupabaseError(error, "Could not create your account.");
        setError(normalizedError);
        logAuthDebug("signup_exception", normalizedError);
        return { error: normalizedError };
      }
    },
    [requestResolution]
  );

  const signOut = useCallback(async () => {
    const signingOutUserId = session?.user.id ?? null;

    if (signingOutUserId) {
      const disableResult = await disablePushNotificationsForUser(
        signingOutUserId,
        profileLanguage
      );

      if (!disableResult.ok) {
        logAuthDebug("logout_push_token_cleanup_failed", disableResult.error);
      }
    }

    const { error: signOutError } = await signOutFromSupabase();

    if (signOutError && !isAuthSessionError(signOutError)) {
      setError(signOutError);
      return { error: signOutError };
    }

    if (signOutError) {
      logAuthDebug("logout_stale_session_cleared", signOutError);
    }

    setError(null);
    await requestResolution(null, "blocking");
    trackAnalyticsEvent("auth_signed_out", {
      language: profileLanguage ?? undefined
    });

    return { error: null };
  }, [profileLanguage, requestResolution, session?.user.id]);

  // The one place that learns the canonical language remembers it, so the next
  // cold start can open the launch screen in it instead of in English while the
  // profile loads. Display only: profiles.language stays the source of truth,
  // and the cache is never read once profileLanguage is set.
  useEffect(() => {
    if (profileLanguage) {
      rememberBootLanguage(profileLanguage);
    }
  }, [profileLanguage]);

  useEffect(() => {
    // The single authoritative initial resolution. refreshAuthState normalises
    // every failure internally; the catch is the last line of defence so a
    // transient boot-time network error can never escape as an unhandled
    // rejection.
    void refreshAuthState().catch((error: unknown) => {
      logAuthDebug("auth_refresh_failed", normalizeSupabaseError(error));
    });

    if (!supabase) {
      return undefined;
    }

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // INITIAL_SESSION is the stored session the bootstrap above is already
      // resolving; resolving it here too was a second, overlapping bootstrap.
      if (event === "INITIAL_SESSION") {
        return;
      }

      const userId = nextSession?.user?.id ?? null;

      // TOKEN_REFRESHED, USER_UPDATED and a re-emitted SIGNED_IN for a reader we
      // already know (or are resolving) carry a new token, not a new person. The
      // profile and its onboarding state cannot have changed: update the session
      // and nothing else.
      if (
        userId &&
        (resolvedUserIdRef.current === userId || inFlightRef.current?.userId === userId)
      ) {
        setSession(nextSession);
        return;
      }

      // A different reader, a first sign-in, or no session at all (SIGNED_OUT).
      void requestResolution(nextSession, "background").catch((error: unknown) => {
        logAuthDebug("auth_state_change_failed", normalizeSupabaseError(error));
      });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshAuthState, requestResolution]);

  useEffect(() => {
    let isMounted = true;

    async function applyAuthUrl(url: string | null) {
      if (!url) {
        return;
      }

      const result = await applySupabaseAuthUrl(url);

      if (!isMounted) {
        return;
      }

      if (result.error) {
        setError(result.error);
        logAuthDebug("auth_url_error", result.error);
        return;
      }

      if (result.data) {
        await requestResolution(result.data, "blocking");
        logAuthDebug("auth_url_session_applied");
      }
    }

    // Deep-link resolution is best effort: a cold start with no network can
    // reject here, and a failed auth-link read must not become an unhandled
    // rejection on top of the offline state the UI already shows.
    void Linking.getInitialURL()
      .then(applyAuthUrl)
      .catch((error: unknown) => {
        logAuthDebug("auth_url_read_failed", normalizeSupabaseError(error));
      });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void applyAuthUrl(url).catch((error: unknown) => {
        logAuthDebug("auth_url_apply_failed", normalizeSupabaseError(error));
      });
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [requestResolution]);

  const value = useMemo(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      error,
      profileCompleted,
      profileLanguage,
      // Checked against the session's user on every read, so a switch of
      // account can never show the previous reader's modules, even for the
      // render between the new session and its profile read.
      moduleFlags: moduleFlagsFor(ownedModuleFlags, session?.user?.id),
      isConfigured: hasSupabaseConfig,
      applyProfileLanguage,
      applyModuleFlags,
      refreshAuthState,
      refreshProfile,
      signInWithEmail,
      signUpWithEmail,
      signOut
    }),
    [
      applyModuleFlags,
      applyProfileLanguage,
      error,
      ownedModuleFlags,
      profileCompleted,
      profileLanguage,
      refreshAuthState,
      refreshProfile,
      session,
      signInWithEmail,
      signOut,
      signUpWithEmail,
      status
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function logAuthDebug(event: string, error?: NormalizedSupabaseError | null) {
  if (!__DEV__) {
    return;
  }

  console.info("[Auth]", {
    code: error?.code,
    event,
    hasError: Boolean(error),
    hint: error?.hint,
    supabase: supabaseConfigDiagnostics
  });
}

function logProfileProof(event: string, details: Record<string, unknown>) {
  if (__DEV__) {
    console.info("[Profile proof]", {
      event,
      ...details
    });
  }
}


function getAuthConfigError(): NormalizedSupabaseError {
  return (
    getSupabaseConfigError() ?? {
      code: "missing_supabase_config",
      message: "Sign-in is not configured for this build.",
      hint:
        "Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
    }
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}
