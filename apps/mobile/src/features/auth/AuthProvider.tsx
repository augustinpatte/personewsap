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
import { trackAnalyticsEvent } from "../../lib/analytics";
import type { Language } from "../../types/domain";

type AuthStatus = "loading" | "signedOut" | "needsOnboarding" | "ready";

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
  isConfigured: boolean;
  refreshAuthState: () => Promise<void>;
  signInWithEmail: (params: SignInParams) => Promise<AuthActionResult>;
  signUpWithEmail: (params: SignUpParams) => Promise<AuthActionResult>;
  signOut: () => Promise<AuthActionResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function getLocalTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

async function createProfileIfMissing(user: User) {
  if (!supabase) {
    return {
      error: getAuthConfigError()
    };
  }

  try {
    const { data: existingProfile, error: readError } = await supabase
      .from("profiles")
      .select("id, language")
      .eq("id", user.id)
      .maybeSingle();

    if (readError) {
      logProfileProof("profile_read_failed", {
        reason: "supabase_error",
        user_id: redactIdentifier(user.id)
      });

      return { error: normalizeSupabaseError(readError, "Could not read your mobile profile.") };
    }

    if (existingProfile) {
      logProfileProof("profile_exists", {
        language: existingProfile.language,
        user_id: redactIdentifier(user.id)
      });

      return { error: null, language: existingProfile.language };
    }

    const { error: insertError } = await supabase.from("profiles").insert({
      id: user.id,
      email: user.email ?? "",
      language: "en",
      timezone: getLocalTimezone()
    });

    if (insertError?.code === "23505") {
      logProfileProof("profile_exists", {
        reason: "unique_conflict",
        user_id: redactIdentifier(user.id)
      });

      return { error: null, language: "en" as const };
    }

    if (insertError) {
      logProfileProof("profile_save_failed", {
        reason: "supabase_error",
        user_id: redactIdentifier(user.id)
      });

      return { error: normalizeSupabaseError(insertError) };
    }

    logProfileProof("profile_saved", {
      language: "en",
      user_id: redactIdentifier(user.id)
    });

    return { error: null, language: "en" as const };
  } catch (error) {
    logProfileProof("profile_save_failed", {
      reason: "exception",
      user_id: redactIdentifier(user.id)
    });

    return {
      error: normalizeSupabaseError(error, "Could not create your mobile profile.")
    };
  }
}

async function getProfileCompleted(userId: string) {
  if (!supabase) {
    return {
      completed: false,
      language: null,
      error: {
        code: "missing_supabase_config",
        message: "Live account data is not configured for this build.",
        hint:
          "Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
      }
    };
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, language")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      return { completed: false, language: null, error: normalizeSupabaseError(profileError) };
    }

    const { data: preferences, error: preferencesError } = await supabase
      .from("user_preferences")
      .select("user_id, newsletter_enabled, mini_cases_enabled")
      .eq("user_id", userId)
      .maybeSingle();

    if (preferencesError) {
      return { completed: false, language: profile?.language ?? null, error: normalizeSupabaseError(preferencesError) };
    }

    const { data: topicPreference, error: topicPreferenceError } = await supabase
      .from("user_topic_preferences")
      .select("topic_id")
      .eq("user_id", userId)
      .eq("enabled", true)
      .limit(1)
      .maybeSingle();

    if (topicPreferenceError) {
      return { completed: false, language: profile?.language ?? null, error: normalizeSupabaseError(topicPreferenceError) };
    }

    const { data: miniCaseTopicPreference, error: miniCaseTopicPreferenceError } = await supabase
      .from("user_mini_case_topic_preferences")
      .select("topic_id")
      .eq("user_id", userId)
      .eq("enabled", true)
      .limit(1)
      .maybeSingle();

    if (miniCaseTopicPreferenceError) {
      return { completed: false, language: profile?.language ?? null, error: normalizeSupabaseError(miniCaseTopicPreferenceError) };
    }

    const newsletterReady = preferences?.newsletter_enabled === false || Boolean(topicPreference);
    const miniCaseReady = preferences?.mini_cases_enabled === false || Boolean(miniCaseTopicPreference);

    return {
      completed: Boolean(profile && preferences && newsletterReady && miniCaseReady),
      language: profile?.language ?? null,
      error: null
    };
  } catch (error) {
    const normalizedError = normalizeSupabaseError(error, "Could not check onboarding status.");
    logAuthDebug("profile_completion_exception", normalizedError);

    return {
      completed: false,
      language: null,
      error: normalizedError
    };
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [profileCompleted, setProfileCompleted] = useState(false);
  const [profileLanguage, setProfileLanguage] = useState<Language | null>(null);
  const [error, setError] = useState<NormalizedSupabaseError | null>(null);
  const authApplySequenceRef = useRef(0);

  const applySession = useCallback(async (nextSession: Session | null) => {
    const sequence = authApplySequenceRef.current + 1;
    authApplySequenceRef.current = sequence;
    const isCurrent = () => authApplySequenceRef.current === sequence;

    setSession(nextSession);

    if (!nextSession?.user) {
      setProfileCompleted(false);
      setProfileLanguage(null);
      setStatus("signedOut");
      return null;
    }

    const profileResult = await createProfileIfMissing(nextSession.user);
    if (!isCurrent()) {
      return null;
    }

    if (profileResult.error) {
      if (isAuthSessionError(profileResult.error)) {
        await clearLocalAuthSession();
        if (!isCurrent()) {
          return null;
        }
        setSession(null);
        setProfileCompleted(false);
        setProfileLanguage(null);
        setError(profileResult.error);
        setStatus("signedOut");
        return profileResult.error;
      }

      setError(profileResult.error);
      setProfileCompleted(false);
      setProfileLanguage(null);
      setStatus("needsOnboarding");
      return profileResult.error;
    }

    const profileStatus = await getProfileCompleted(nextSession.user.id);
    if (!isCurrent()) {
      return null;
    }

    if (profileStatus.error && isAuthSessionError(profileStatus.error)) {
      await clearLocalAuthSession();
      if (!isCurrent()) {
        return null;
      }
      setSession(null);
      setError(profileStatus.error);
      setProfileCompleted(false);
      setProfileLanguage(null);
      setStatus("signedOut");
      return profileStatus.error;
    }

    setError(profileStatus.error);
    setProfileCompleted(profileStatus.completed);
    setProfileLanguage(profileStatus.language ?? profileResult.language ?? null);
    setStatus(profileStatus.completed ? "ready" : "needsOnboarding");
    return profileStatus.error ?? null;
  }, []);

  const refreshAuthState = useCallback(async () => {
    setStatus("loading");

    const { data, error: sessionError } = await getValidatedAuthSession();

    if (sessionError) {
      setError(sessionError);
      setSession(null);
      setProfileCompleted(false);
      setProfileLanguage(null);
      setStatus("signedOut");
      return;
    }

    setError(null);
    await applySession(data);
  }, [applySession]);

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
        const sessionApplyError = await applySession(data.session);
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
    [applySession]
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
        const sessionApplyError = await applySession(data.session);
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
    [applySession]
  );

  const signOut = useCallback(async () => {
    const { error: signOutError } = await signOutFromSupabase();

    if (signOutError && !isAuthSessionError(signOutError)) {
      setError(signOutError);
      return { error: signOutError };
    }

    if (signOutError) {
      logAuthDebug("logout_stale_session_cleared", signOutError);
    }

    setError(null);
    await applySession(null);
    trackAnalyticsEvent("auth_signed_out", {
      language: profileLanguage ?? undefined
    });

    return { error: null };
  }, [applySession, profileLanguage]);

  useEffect(() => {
    void refreshAuthState();

    if (!supabase) {
      return undefined;
    }

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void applySession(nextSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [applySession, refreshAuthState]);

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
        await applySession(result.data);
        logAuthDebug("auth_url_session_applied");
      }
    }

    void Linking.getInitialURL().then(applyAuthUrl);

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void applyAuthUrl(url);
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [applySession]);

  const value = useMemo(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      error,
      profileCompleted,
      profileLanguage,
      isConfigured: hasSupabaseConfig,
      refreshAuthState,
      signInWithEmail,
      signUpWithEmail,
      signOut
    }),
    [
      error,
      profileCompleted,
      profileLanguage,
      refreshAuthState,
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

function redactIdentifier(identifier: string): string {
  return identifier.length <= 8
    ? identifier
    : `${identifier.slice(0, 4)}...${identifier.slice(-4)}`;
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
