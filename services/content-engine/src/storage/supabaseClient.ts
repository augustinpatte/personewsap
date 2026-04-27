import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ContentEngineSupabaseClient = SupabaseClient;

export function createServiceRoleSupabaseClient(options?: {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  requireCredentials?: boolean;
}): ContentEngineSupabaseClient {
  const supabaseUrl = options?.supabaseUrl ?? process.env.SUPABASE_URL;
  const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missingCredentials = [
    supabaseUrl ? null : "SUPABASE_URL",
    serviceRoleKey ? null : "SUPABASE_SERVICE_ROLE_KEY"
  ].filter((name): name is string => name !== null);

  if (missingCredentials.length > 0) {
    const message = missingPersistenceCredentialsMessage(missingCredentials);

    if (options?.requireCredentials === true) {
      throw new Error(message);
    }

    return createMissingCredentialsClient(message);
  }

  return createClient(supabaseUrl as string, serviceRoleKey as string, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function missingPersistenceCredentialsMessage(missingCredentials: string[]): string {
  return [
    `Content-engine Supabase persistence requires ${missingCredentials.join(" and ")} in a server-side environment.`,
    "Run daily jobs with persist=true only after SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured.",
    "Never expose SUPABASE_SERVICE_ROLE_KEY in Expo, Vite, or any mobile/client app code."
  ].join(" ");
}

function createMissingCredentialsClient(message: string): ContentEngineSupabaseClient {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return undefined;
        }

        throw new Error(message);
      }
    }
  ) as ContentEngineSupabaseClient;
}
