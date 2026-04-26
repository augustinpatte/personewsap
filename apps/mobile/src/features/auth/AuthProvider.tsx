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

import {
  getAuthSession,
  hasSupabaseConfig,
  normalizeSupabaseError,
  signOut as signOutFromSupabase,
  supabase,
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

async function ensureProfile(user: User) {
  if (!supabase) {
    return {
      error: {
        code: "missing_supabase_config",
        message: "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
      }
    };
  }

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? "",
      language: "en",
      timezone: getLocalTimezone()
    },
    { onConflict: "id" }
  );

  return { error: error ? normalizeSupabaseError(error) : null };
}

async function getProfileCompleted(userId: string) {
  if (!supabase) {
    return {
      completed: false,
      error: {
        code: "missing_supabase_config",
        message: "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
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
        const missingConfigError = {
          code: "missing_supabase_config",
          message: "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
        };
        setError(missingConfigError);
        return { error: missingConfigError };
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (signInError) {
        const normalizedError = normalizeSupabaseError(signInError);
        setError(normalizedError);
        return { error: normalizedError };
      }

      if (data.user) {
        const { error: profileError } = await ensureProfile(data.user);
        if (profileError) {
          setError(profileError);
          return { error: profileError };
        }
      }

      setError(null);
      await applySession(data.session);

      return { error: null };
    },
    [applySession]
  );

  const signUpWithEmail = useCallback(
    async ({ email, password }: SignUpParams) => {
      if (!supabase) {
        const missingConfigError = {
          code: "missing_supabase_config",
          message: "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
        };
        setError(missingConfigError);
        return { error: missingConfigError };
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password
      });

      if (signUpError) {
        const normalizedError = normalizeSupabaseError(signUpError);
        setError(normalizedError);
        return { error: normalizedError };
      }

      if (data.user && data.session) {
        const { error: profileError } = await ensureProfile(data.user);
        if (profileError) {
          setError(profileError);
          return { error: profileError };
        }
      }

      setError(null);
      await applySession(data.session);

      return {
        error: null,
        needsEmailConfirmation: !data.session
      };
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

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}
