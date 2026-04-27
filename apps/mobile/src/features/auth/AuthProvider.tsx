import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";

import {
  applySupabaseAuthUrl,
  getAuthSession,
  getSupabaseConfigError,
  hasSupabaseConfig,
  normalizeSupabaseError,
  signOut as signOutFromSupabase,
  supabase,
  supabaseConfigDiagnostics,
  type NormalizedSupabaseError
} from "../../lib/supabase";

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
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (readError) {
      return { error: normalizeSupabaseError(readError, "Could not read your mobile profile.") };
    }

    if (existingProfile) {
      return { error: null };
    }

    const { error: insertError } = await supabase.from("profiles").insert({
      id: user.id,
      email: user.email ?? "",
      language: "en",
      timezone: getLocalTimezone()
    });

    if (insertError?.code === "23505") {
      return { error: null };
    }

    return { error: insertError ? normalizeSupabaseError(insertError) : null };
  } catch (error) {
    return {
      error: normalizeSupabaseError(error, "Could not create your mobile profile.")
    };
  }
}

async function getProfileCompleted(userId: string) {
  if (!supabase) {
    return {
      completed: false,
      error: {
        code: "missing_supabase_config",
        message: "Live account data is not configured for this build.",
        hint:
          "Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
      }
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return { completed: false, error: normalizeSupabaseError(profileError) };
  }

  const { data: preferences, error: preferencesError } = await supabase
    .from("user_preferences")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (preferencesError) {
    return { completed: false, error: normalizeSupabaseError(preferencesError) };
  }

  const { data: topicPreference, error: topicPreferenceError } = await supabase
    .from("user_topic_preferences")
    .select("topic_id")
    .eq("user_id", userId)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();

  if (topicPreferenceError) {
    return { completed: false, error: normalizeSupabaseError(topicPreferenceError) };
  }

  return {
    completed: Boolean(profile && preferences && topicPreference),
    error: null
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [profileCompleted, setProfileCompleted] = useState(false);
  const [error, setError] = useState<NormalizedSupabaseError | null>(null);

  const applySession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);

    if (!nextSession?.user) {
      setProfileCompleted(false);
      setStatus("signedOut");
      return;
    }

    const profileResult = await createProfileIfMissing(nextSession.user);
    if (profileResult.error) {
      setError(profileResult.error);
      setProfileCompleted(false);
      setStatus("needsOnboarding");
      return;
    }

    const profileStatus = await getProfileCompleted(nextSession.user.id);
    setError(profileStatus.error);
    setProfileCompleted(profileStatus.completed);
    setStatus(profileStatus.completed ? "ready" : "needsOnboarding");
  }, []);

  const refreshAuthState = useCallback(async () => {
    setStatus("loading");

    const { data, error: sessionError } = await getAuthSession();

    if (sessionError) {
      setError(sessionError);
      setSession(null);
      setProfileCompleted(false);
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
        await applySession(data.session);
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
        await applySession(data.session);
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

    if (signOutError) {
      setError(signOutError);
      return { error: signOutError };
    }

    setError(null);
    await applySession(null);

    return { error: null };
  }, [applySession]);

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
      isConfigured: hasSupabaseConfig,
      refreshAuthState,
      signInWithEmail,
      signUpWithEmail,
      signOut
    }),
    [
      error,
      profileCompleted,
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
