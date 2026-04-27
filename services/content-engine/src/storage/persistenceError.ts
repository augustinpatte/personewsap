export type SupabaseErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

export type SerializedPersistenceError = {
  message: string;
  table?: string;
  action?: string;
  code?: string;
  details?: string;
  hint?: string;
  cause?: unknown;
};

export class PersistenceError extends Error {
  readonly table: string;
  readonly action: string;
  readonly code?: string;
  readonly details?: string;
  readonly hint?: string;

  constructor(input: {
    table: string;
    action: string;
    error: unknown;
  }) {
    const supabaseError = asSupabaseError(input.error);
    const message = supabaseError.message ?? stringifyUnknownError(input.error);

    super(`${input.action} on ${input.table} failed: ${message}`);
    this.name = "PersistenceError";
    this.table = input.table;
    this.action = input.action;
    this.code = supabaseError.code;
    this.details = supabaseError.details;
    this.hint = supabaseError.hint;
    this.cause = input.error;
  }
}

export function throwPersistenceError(input: {
  table: string;
  action: string;
  error: unknown;
}): never {
  throw new PersistenceError(input);
}

export function serializePersistenceError(error: unknown): SerializedPersistenceError {
  if (error instanceof PersistenceError) {
    return {
      message: redactSensitiveText(error.message) ?? "Unknown persistence error",
      table: error.table,
      action: error.action,
      code: redactSensitiveText(error.code),
      details: redactSensitiveText(error.details),
      hint: redactSensitiveText(error.hint),
      cause: serializeCause(error.cause)
    };
  }

  const supabaseError = asSupabaseError(error);

  return {
    message: redactSensitiveText(supabaseError.message ?? stringifyUnknownError(error)) ?? "Unknown persistence error",
    code: redactSensitiveText(supabaseError.code),
    details: redactSensitiveText(supabaseError.details),
    hint: redactSensitiveText(supabaseError.hint),
    cause: serializeCause(error)
  };
}

export function formatPersistenceError(error: unknown): string {
  const serialized = serializePersistenceError(error);
  const lines = [`content-engine failed: ${serialized.message}`];

  if (serialized.table || serialized.action) {
    lines.push(`action: ${serialized.action ?? "unknown"}`);
    lines.push(`table: ${serialized.table ?? "unknown"}`);
  }

  if (serialized.code) {
    lines.push(`supabase_code: ${serialized.code}`);
  }

  if (serialized.details) {
    lines.push(`supabase_details: ${serialized.details}`);
  }

  if (serialized.hint) {
    lines.push(`supabase_hint: ${serialized.hint}`);
  }

  return lines.join("\n");
}

function asSupabaseError(error: unknown): SupabaseErrorLike {
  if (typeof error !== "object" || error === null) {
    return {};
  }

  const record = error as Record<string, unknown>;

  return {
    message: typeof record.message === "string" ? record.message : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
    details: typeof record.details === "string" ? record.details : undefined,
    hint: typeof record.hint === "string" ? record.hint : undefined
  };
}

function serializeCause(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return typeof error === "string" ? redactSensitiveText(error) : error;
  }

  const supabaseError = asSupabaseError(error);
  if (supabaseError.message || supabaseError.code || supabaseError.details || supabaseError.hint) {
    return {
      message: redactSensitiveText(supabaseError.message),
      code: redactSensitiveText(supabaseError.code),
      details: redactSensitiveText(supabaseError.details),
      hint: redactSensitiveText(supabaseError.hint)
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveText(error.message)
    };
  }

  return redactUnknownObject(error);
}

function stringifyUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitiveText(error.message) ?? "Unknown error";
  }

  if (typeof error === "string") {
    return redactSensitiveText(error) ?? "";
  }

  try {
    return redactSensitiveText(JSON.stringify(error)) ?? "Unknown error";
  } catch {
    return redactSensitiveText(String(error)) ?? "Unknown error";
  }
}

function redactUnknownObject(error: object): unknown {
  try {
    return JSON.parse(redactSensitiveText(JSON.stringify(error)) ?? "{}");
  } catch {
    return "[unserializable object]";
  }
}

function redactSensitiveText(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  let redacted = value;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (serviceRoleKey) {
    redacted = redacted.split(serviceRoleKey).join("[REDACTED_SUPABASE_SERVICE_ROLE_KEY]");
  }

  return redacted
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_JWT]")
    .replace(/\bre_[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_RESEND_KEY]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]");
}
