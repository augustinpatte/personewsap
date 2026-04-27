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
  fallbackMessage = "Unexpected Supabase error"
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
        message:
          "Supabase is still using placeholder values. Replace EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env."
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
          message:
            "EXPO_PUBLIC_SUPABASE_URL must be a valid HTTPS Supabase URL, or a local development URL."
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
        message:
          "EXPO_PUBLIC_SUPABASE_URL is not a valid URL. Use the Project URL from Supabase settings."
      },
      isConfigured: false,
      urlHost: null
    };
  }
}

function createMissingSupabaseConfigError(): NormalizedSupabaseError {
  return {
    code: "missing_supabase_config",
    message:
      "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env."
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

function normalizeNetworkErrorMessage(
  error: NormalizedSupabaseError
): NormalizedSupabaseError {
  if (error.message.toLowerCase().includes("network request failed")) {
    return {
      ...error,
      code: error.code ?? "network_request_failed",
      hint:
        error.hint ??
        "Check apps/mobile/.env, restart Expo after changing env vars, and confirm the Supabase URL is reachable from this device."
    };
  }

  return error;
}
