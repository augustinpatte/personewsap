import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ContentEngineSupabaseClient = SupabaseClient;

export function createServiceRoleSupabaseClient(options?: {
  supabaseUrl?: string;
  serviceRoleKey?: string;
}): ContentEngineSupabaseClient {
  const supabaseUrl = options?.supabaseUrl ?? process.env.SUPABASE_URL;
  const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for content-engine persistence.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
