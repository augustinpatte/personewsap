import type { NormalizedSupabaseError } from "./supabase";

export type AsyncDataStatus = "idle" | "loading" | "ready" | "empty" | "error";

export type AsyncDataState<T> = {
  data: T | null;
  error: NormalizedSupabaseError | null;
  message: string | null;
  status: AsyncDataStatus;
};

export type DataFetchSource = "supabase" | "mock";

export type DataFallbackReason =
  | "missing_supabase_config"
  | "no_supabase_data"
  | "supabase_error";

export type DataFetchResult<T> = {
  data: T;
  error: NormalizedSupabaseError | null;
  fallbackReason: DataFallbackReason | null;
  source: DataFetchSource;
  state: AsyncDataState<T>;
};

export function createIdleState<T>(): AsyncDataState<T> {
  return {
    data: null,
    error: null,
    message: null,
    status: "idle"
  };
}

export function createLoadingState<T>(
  previousData: T | null = null
): AsyncDataState<T> {
  return {
    data: previousData,
    error: null,
    message: null,
    status: "loading"
  };
}

export function createReadyState<T>(data: T): AsyncDataState<T> {
  return {
    data,
    error: null,
    message: null,
    status: "ready"
  };
}

export function createEmptyState<T>(
  message = "No content is available yet."
): AsyncDataState<T> {
  return {
    data: null,
    error: null,
    message,
    status: "empty"
  };
}

export function createErrorState<T>(
  error: NormalizedSupabaseError,
  fallbackData: T | null = null
): AsyncDataState<T> {
  return {
    data: fallbackData,
    error,
    message: error.message,
    status: "error"
  };
}

export function createSupabaseResult<T>(data: T): DataFetchResult<T> {
  return {
    data,
    error: null,
    fallbackReason: null,
    source: "supabase",
    state: createReadyState(data)
  };
}

export function createMockFallbackResult<T>(
  data: T,
  fallbackReason: DataFallbackReason,
  error: NormalizedSupabaseError | null = null
): DataFetchResult<T> {
  return {
    data,
    error,
    fallbackReason,
    source: "mock",
    state: error ? createErrorState(error, data) : createReadyState(data)
  };
}
