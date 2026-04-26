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

type AuthResult<T> = {
  data: T | null;
  error: NormalizedSupabaseError | null;
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

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

export function normalizeSupabaseError(
  error: unknown,
  fallbackMessage = "Unexpected Supabase error"
): NormalizedSupabaseError {
  if (!error) {
    return { message: fallbackMessage };
  }

  if (typeof error === "string") {
    return { message: error };
  }

  if (error instanceof Error) {
    const authError = error as AuthError;
    const postgrestError = error as AuthError & {
      details?: string;
      hint?: string;
    };

    return {
      message: authError.message || fallbackMessage,
      name: authError.name,
      code: authError.code,
      status: authError.status,
      details: postgrestError.details,
      hint: postgrestError.hint
    };
  }

  if (typeof error === "object") {
    const maybeError = error as Partial<NormalizedSupabaseError>;

    return {
      message: maybeError.message ?? fallbackMessage,
      name: maybeError.name,
      code: maybeError.code,
      status: maybeError.status,
      details: maybeError.details,
      hint: maybeError.hint
    };
  }

  return { message: fallbackMessage };
}

export async function getAuthSession(): Promise<AuthResult<Session>> {
  if (!supabase) {
    return {
      data: null,
      error: {
        code: "missing_supabase_config",
        message:
          "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
      }
    };
  }

  const { data, error } = await supabase.auth.getSession();

  return {
    data: data.session,
    error: error ? normalizeSupabaseError(error) : null
  };
}

export async function signOut(): Promise<AuthResult<null>> {
  if (!supabase) {
    return {
      data: null,
      error: {
        code: "missing_supabase_config",
        message:
          "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
      }
    };
  }

  const { error } = await supabase.auth.signOut();

  return {
    data: null,
    error: error ? normalizeSupabaseError(error) : null
  };
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

if (!hasSupabaseConfig && __DEV__) {
  console.warn(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Mobile Supabase calls are disabled."
  );
}
