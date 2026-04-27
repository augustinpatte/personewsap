import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createClient,
  processLock,
  type AuthError,
  type Session,
  type SupabaseClient
} from "@supabase/supabase-js";
import { AppState } from "react-native";

import type { Database } from "@/types/database";

export type MobileSupabaseClient = SupabaseClient<Database>;

export type NormalizedSupabaseError = {
  message: string;
  name?: string;
  code?: string;
  status?: number;
  details?: string;
  hint?: string;
};

export type SupabaseConfigStatus = {
  anonKeyPresent: boolean;
  error: NormalizedSupabaseError | null;
  isConfigured: boolean;
  urlHost: string | null;
};

type AuthResult<T> = {
  data: T | null;
  error: NormalizedSupabaseError | null;
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
const supabaseConfigStatus = validateSupabaseConfig(supabaseUrl, supabaseAnonKey);

export const hasSupabaseConfig = supabaseConfigStatus.isConfigured;
export const supabaseConfigError = supabaseConfigStatus.error;
export const supabaseConfigDiagnostics = {
  anonKeyPresent: supabaseConfigStatus.anonKeyPresent,
  isConfigured: supabaseConfigStatus.isConfigured,
  urlHost: supabaseConfigStatus.urlHost
};

export const supabase: MobileSupabaseClient | null = hasSupabaseConfig
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        lock: processLock,
        storageKey: "personewsap-mobile-auth"
      }
    })
  : null;

export function getSupabaseConfigError(): NormalizedSupabaseError | null {
  return supabaseConfigError;
}

export function normalizeSupabaseError(
  error: unknown,
  fallbackMessage = "Unexpected live data error"
): NormalizedSupabaseError {
  if (!error) {
    return { message: fallbackMessage };
  }

  if (typeof error === "string") {
    return normalizeNetworkErrorMessage({ message: error });
  }

  if (error instanceof Error) {
    const authError = error as AuthError;
    const postgrestError = error as AuthError & {
      details?: string;
      hint?: string;
    };

    return normalizeNetworkErrorMessage({
      message: authError.message || fallbackMessage,
      name: authError.name,
      code: authError.code,
      status: authError.status,
      details: postgrestError.details,
      hint: postgrestError.hint
    });
  }

  if (typeof error === "object") {
    const maybeError = error as Partial<NormalizedSupabaseError>;

    return normalizeNetworkErrorMessage({
      message: maybeError.message ?? fallbackMessage,
      name: maybeError.name,
      code: maybeError.code,
      status: maybeError.status,
      details: maybeError.details,
      hint: maybeError.hint
    });
  }

  return { message: fallbackMessage };
}

export async function getAuthSession(): Promise<AuthResult<Session>> {
  if (!supabase) {
    return {
      data: null,
      error: getSupabaseConfigError() ?? createMissingSupabaseConfigError()
    };
  }

  try {
    const { data, error } = await supabase.auth.getSession();

    return {
      data: data.session,
      error: error ? normalizeSupabaseError(error) : null
    };
  } catch (error) {
    return {
      data: null,
      error: normalizeSupabaseError(error, "Could not read the auth session.")
    };
  }
}

export async function signOut(): Promise<AuthResult<null>> {
  if (!supabase) {
    return {
      data: null,
      error: getSupabaseConfigError() ?? createMissingSupabaseConfigError()
    };
  }

  try {
    const { error } = await supabase.auth.signOut();

    return {
      data: null,
      error: error ? normalizeSupabaseError(error) : null
    };
  } catch (error) {
    return {
      data: null,
      error: normalizeSupabaseError(error, "Could not sign out.")
    };
  }
}

export async function requestPasswordReset(email: string): Promise<AuthResult<null>> {
  if (!supabase) {
    return {
      data: null,
      error: getSupabaseConfigError() ?? createMissingSupabaseConfigError()
    };
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: "personewsap://reset-password"
    });

    return {
      data: null,
      error: error ? normalizeSupabaseError(error, "Could not send password reset email.") : null
    };
  } catch (error) {
    return {
      data: null,
      error: normalizeSupabaseError(error, "Could not send password reset email.")
    };
  }
}

export async function updatePassword(password: string): Promise<AuthResult<null>> {
  if (!supabase) {
    return {
      data: null,
      error: getSupabaseConfigError() ?? createMissingSupabaseConfigError()
    };
  }

  try {
    const { error } = await supabase.auth.updateUser({ password });

    return {
      data: null,
      error: error ? normalizeSupabaseError(error, "Could not update password.") : null
    };
  } catch (error) {
    return {
      data: null,
      error: normalizeSupabaseError(error, "Could not update password.")
    };
  }
}

export async function applySupabaseAuthUrl(url: string): Promise<AuthResult<Session>> {
  if (!supabase) {
    return {
      data: null,
      error: getSupabaseConfigError() ?? createMissingSupabaseConfigError()
    };
  }

  const params = getAuthUrlParams(url);
  const authError = params.get("error") ?? params.get("error_code");

  if (authError) {
    return {
      data: null,
      error: normalizeSupabaseError({
        code: authError,
        message: params.get("error_description") ?? "The sign-in link could not be opened."
      })
    };
  }

  const code = params.get("code");

  if (code) {
    try {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      return {
        data: data.session,
        error: error ? normalizeSupabaseError(error, "Could not open the sign-in link.") : null
      };
    } catch (error) {
      return {
        data: null,
        error: normalizeSupabaseError(error, "Could not open the sign-in link.")
      };
    }
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (accessToken && refreshToken) {
    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      return {
        data: data.session,
        error: error ? normalizeSupabaseError(error, "Could not open the sign-in link.") : null
      };
    } catch (error) {
      return {
        data: null,
        error: normalizeSupabaseError(error, "Could not open the sign-in link.")
      };
    }
  }

  return { data: null, error: null };
}

if (supabase) {
  if (AppState.currentState === "active") {
    void supabase.auth.startAutoRefresh();
  }

  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void supabase.auth.startAutoRefresh();
      return;
    }

    void supabase.auth.stopAutoRefresh();
  });
}

if (__DEV__) {
  console.info("[Supabase config]", {
    anonKeyPresent: supabaseConfigDiagnostics.anonKeyPresent,
    isConfigured: supabaseConfigDiagnostics.isConfigured,
    urlHost: supabaseConfigDiagnostics.urlHost
  });

  if (!hasSupabaseConfig) {
    console.warn(
      `[Supabase config] ${supabaseConfigError?.message ?? createMissingSupabaseConfigError().message}`
    );
  }
}

function validateSupabaseConfig(url: string, anonKey: string): SupabaseConfigStatus {
  if (!url || !anonKey) {
    return {
      anonKeyPresent: Boolean(anonKey),
      error: createMissingSupabaseConfigError(),
      isConfigured: false,
      urlHost: getUrlHost(url)
    };
  }

  if (isPlaceholderSupabaseValue(url) || isPlaceholderSupabaseValue(anonKey)) {
    return {
      anonKeyPresent: Boolean(anonKey),
      error: {
        code: "placeholder_supabase_config",
        message: "Live data is still using placeholder values.",
        hint:
          "Developer/Test info: replace EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env, then restart Expo."
      },
      isConfigured: false,
      urlHost: getUrlHost(url)
    };
  }

  try {
    const parsedUrl = new URL(url);
    const isLocalHttp =
      parsedUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1", "10.0.2.2"].includes(parsedUrl.hostname);

    if (parsedUrl.protocol !== "https:" && !isLocalHttp) {
      return {
        anonKeyPresent: true,
        error: {
          code: "invalid_supabase_url",
          message: "The live data URL is not valid.",
          hint:
            "Developer/Test info: EXPO_PUBLIC_SUPABASE_URL must be HTTPS, or a local development URL."
        },
        isConfigured: false,
        urlHost: parsedUrl.host
      };
    }

    return {
      anonKeyPresent: true,
      error: null,
      isConfigured: true,
      urlHost: parsedUrl.host
    };
  } catch {
    return {
      anonKeyPresent: true,
      error: {
        code: "invalid_supabase_url",
        message: "The live data URL is not valid.",
        hint:
          "Developer/Test info: use the Project URL from Supabase settings for EXPO_PUBLIC_SUPABASE_URL."
      },
      isConfigured: false,
      urlHost: null
    };
  }
}

function createMissingSupabaseConfigError(): NormalizedSupabaseError {
  return {
    code: "missing_supabase_config",
    message: "Live data is not configured for this build.",
    hint:
      "Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
  };
}

function getUrlHost(url: string): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

function isPlaceholderSupabaseValue(value: string): boolean {
  const normalizedValue = value.toLowerCase();

  return (
    normalizedValue.includes("your-project") ||
    normalizedValue.includes("your-anon-key") ||
    normalizedValue.includes("replace-me")
  );
}

function getAuthUrlParams(url: string): URLSearchParams {
  try {
    const parsedUrl = new URL(url);
    const params = new URLSearchParams(parsedUrl.search);

    if (parsedUrl.hash.startsWith("#")) {
      const hashParams = new URLSearchParams(parsedUrl.hash.slice(1));
      hashParams.forEach((value, key) => params.set(key, value));
    }

    return params;
  } catch {
    return new URLSearchParams();
  }
}

function normalizeNetworkErrorMessage(
  error: NormalizedSupabaseError
): NormalizedSupabaseError {
  const message = error.message.toLowerCase();

  if (
    error.code === "invalid_credentials" ||
    message.includes("invalid login credentials")
  ) {
    return {
      ...error,
      message: "The email or password is incorrect.",
      hint: error.hint ?? "Check the email address and password, then try again."
    };
  }

  if (message.includes("email not confirmed")) {
    return {
      ...error,
      code: error.code ?? "email_not_confirmed",
      message: "Confirm your email before logging in.",
      hint: error.hint ?? "Open the confirmation email, then return to the app."
    };
  }

  if (message.includes("user already registered") || message.includes("already registered")) {
    return {
      ...error,
      code: error.code ?? "user_already_registered",
      message: "An account already exists for this email.",
      hint: error.hint ?? "Log in instead, or reset your password if you cannot access it."
    };
  }

  if (message.includes("password should be") || message.includes("weak password")) {
    return {
      ...error,
      code: error.code ?? "weak_password",
      message: "Choose a stronger password.",
      hint: error.hint ?? "Use at least 8 characters with a mix of letters and numbers."
    };
  }

  if (message.includes("rate limit") || message.includes("too many requests")) {
    return {
      ...error,
      code: error.code ?? "rate_limited",
      message: "Too many attempts. Wait a moment, then try again."
    };
  }

  if (error.message.toLowerCase().includes("network request failed")) {
    return {
      ...error,
      code: error.code ?? "network_request_failed",
      hint:
        error.hint ??
        "Developer/Test info: check apps/mobile/.env, restart Expo after changing env vars, and confirm the live data URL is reachable from this device."
    };
  }

  return error;
}
