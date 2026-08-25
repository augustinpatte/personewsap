import { createClient } from "@supabase/supabase-js";

import type { ContentEngineSupabaseClient } from "../storage/supabaseClient.js";

/**
 * The staging project, kept deliberately separate from production.
 *
 * Two clients, two credential pairs, two names. Nothing in this file falls back
 * to `SUPABASE_URL` if the staging variables are missing: a misconfigured job
 * that quietly read the production project and found no `automation_batches`
 * would report "no edition ready" instead of "you pointed me at the wrong
 * database", and the difference matters at 19:00 on a publishing evening.
 *
 * Staging is read-only from here except for the publication receipt. ChatGPT
 * writes the editorial content; this engine reads it, and writes back only the
 * fact that production accepted it.
 */

export const STAGING_URL_ENV = "STAGING_SUPABASE_URL";
export const STAGING_KEY_ENV = "STAGING_SUPABASE_SERVICE_ROLE_KEY";

export function createStagingSupabaseClient(options?: {
  supabaseUrl?: string;
  serviceRoleKey?: string;
}): ContentEngineSupabaseClient {
  const supabaseUrl = options?.supabaseUrl ?? process.env[STAGING_URL_ENV];
  const serviceRoleKey = options?.serviceRoleKey ?? process.env[STAGING_KEY_ENV];
  const missing = [
    supabaseUrl ? null : STAGING_URL_ENV,
    serviceRoleKey ? null : STAGING_KEY_ENV
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    throw new Error(
      [
        `Reading the ChatGPT staging project requires ${missing.join(" and ")}.`,
        "These are the staging project's own credentials and are deliberately distinct from SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, which point at production.",
        "Never expose either service-role key in Expo, Vite, or any client code."
      ].join(" ")
    );
  }

  return createClient(supabaseUrl as string, serviceRoleKey as string, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
