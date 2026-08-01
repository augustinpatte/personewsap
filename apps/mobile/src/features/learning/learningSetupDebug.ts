import type { NormalizedSupabaseError } from "../../lib/supabase";

export function getLearningSetupDebugError(
  error: NormalizedSupabaseError | null,
  isDev: boolean
): string | null {
  if (!isDev || !error) {
    return null;
  }

  return [
    error.code ? `code: ${error.code}` : null,
    error.message ? `message: ${error.message}` : null,
    error.details ? `details: ${error.details}` : null,
    error.hint ? `hint: ${error.hint}` : null
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
