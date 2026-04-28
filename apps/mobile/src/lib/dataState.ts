import type { NormalizedSupabaseError } from "./supabase";

export type AsyncDataStatus = "idle" | "loading" | "ready" | "empty" | "error";

export type AsyncDataState<T> = {
  data: T | null;
  error: NormalizedSupabaseError | null;
  message: string | null;
  status: AsyncDataStatus;
};

export type DataFetchSource = "supabase" | "cache" | "mock";

export type DataFallbackReason =
  | "missing_auth_session"
  | "missing_supabase_config"
  | "network_unavailable"
  | "no_supabase_data"
  | "supabase_error";

export type DataIdleState = {
  data: null;
  error: null;
  message: null;
  status: "idle";
};

export type DataLoadingState<T> = {
  data: T | null;
  error: null;
  message: null;
  status: "loading";
};

export type DataSuccessState<T> = {
  data: T;
  error: null;
  message: null;
  status: "ready";
};

export type DataEmptyState = {
  data: null;
  error: null;
  message: string;
  status: "empty";
};

export type DataErrorState<T> = {
  data: T | null;
  error: NormalizedSupabaseError;
  message: string;
  status: "error";
};

export type DataLoadState<T> =
  | DataIdleState
  | DataLoadingState<T>
  | DataSuccessState<T>
  | DataEmptyState
  | DataErrorState<T>;

export type DataFetchResult<T> = {
  data: T;
  error: NormalizedSupabaseError | null;
  fallbackReason: DataFallbackReason | null;
  source: DataFetchSource;
  state: DataLoadState<T>;
};

export function createIdleState(): DataIdleState {
  return {
    data: null,
    error: null,
    message: null,
    status: "idle"
  };
}

export function createLoadingState<T>(
  previousData: T | null = null
): DataLoadingState<T> {
  return {
    data: previousData,
    error: null,
    message: null,
    status: "loading"
  };
}

export function createReadyState<T>(data: T): DataSuccessState<T> {
  return {
    data,
    error: null,
    message: null,
    status: "ready"
  };
}

export function createEmptyState<T>(
  message = "No content is available yet."
): DataEmptyState {
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
): DataErrorState<T> {
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

export function createCachedResult<T>(
  data: T,
  fallbackReason: DataFallbackReason | null = null,
  error: NormalizedSupabaseError | null = null
): DataFetchResult<T> {
  return {
    data,
    error,
    fallbackReason,
    source: "cache",
    state: error ? createErrorState(error, data) : createReadyState(data)
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
