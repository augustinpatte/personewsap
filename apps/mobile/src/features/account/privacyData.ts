import { getAuthSession, normalizeSupabaseError, supabase, type NormalizedSupabaseError } from "../../lib/supabase";

type PrivacyActionResult<T> = {
  data: T | null;
  error: NormalizedSupabaseError | null;
};

type ExportedUserData = {
  exported_at: string;
  user_id: string;
  profile: unknown;
  preferences: unknown;
  newsletter_topic_preferences: unknown[];
  mini_case_topic_preferences: unknown[];
  content_interactions: unknown[];
  mini_case_responses: unknown[];
  push_tokens: unknown[];
  daily_drops: unknown[];
};

const accountDeletionEndpoint =
  process.env.EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT?.trim() ?? "";

export async function exportAuthenticatedUserData(
  userId: string
): Promise<PrivacyActionResult<string>> {
  if (!supabase) {
    return {
      data: null,
      error: {
        code: "missing_supabase_config",
        message: "Live account data is not configured for this build."
      }
    };
  }

  try {
    const [
      profile,
      preferences,
      newsletterTopics,
      miniCaseTopics,
      interactions,
      miniCaseResponses,
      pushTokens,
      dailyDrops
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id,email,legacy_user_id,language,timezone,created_at,updated_at")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("user_preferences").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("user_topic_preferences")
        .select("*")
        .eq("user_id", userId)
        .order("position", { ascending: true, nullsFirst: false }),
      supabase
        .from("user_mini_case_topic_preferences")
        .select("*")
        .eq("user_id", userId)
        .order("position", { ascending: true, nullsFirst: false }),
      supabase
        .from("content_interactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("mini_case_responses")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("push_tokens")
        .select("id,user_id,expo_push_token,platform,enabled,last_registered_at,created_at,updated_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("daily_drops")
        .select("id,user_id,drop_date,language,status,generated_at,published_at,created_at,updated_at")
        .eq("user_id", userId)
        .order("drop_date", { ascending: false })
    ]);

    const firstError =
      profile.error ??
      preferences.error ??
      newsletterTopics.error ??
      miniCaseTopics.error ??
      interactions.error ??
      miniCaseResponses.error ??
      pushTokens.error ??
      dailyDrops.error;

    if (firstError) {
      return {
        data: null,
        error: normalizeSupabaseError(firstError, "Could not export your account data.")
      };
    }

    const exportPayload: ExportedUserData = {
      exported_at: new Date().toISOString(),
      user_id: userId,
      profile: profile.data,
      preferences: preferences.data,
      newsletter_topic_preferences: newsletterTopics.data ?? [],
      mini_case_topic_preferences: miniCaseTopics.data ?? [],
      content_interactions: interactions.data ?? [],
      mini_case_responses: miniCaseResponses.data ?? [],
      push_tokens: pushTokens.data ?? [],
      daily_drops: dailyDrops.data ?? []
    };

    return {
      data: JSON.stringify(exportPayload, null, 2),
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: normalizeSupabaseError(error, "Could not export your account data.")
    };
  }
}

export async function requestAuthenticatedAccountDeletion(
  userId: string
): Promise<PrivacyActionResult<{ requested: true }>> {
  if (!accountDeletionEndpoint) {
    return {
      data: null,
      error: {
        code: "account_deletion_endpoint_missing",
        message:
          "Account deletion requests are not enabled in this build. Contact the PersoNewsAP operator through the official support channel."
      }
    };
  }

  const sessionResult = await getAuthSession();

  if (sessionResult.error || !sessionResult.data) {
    return {
      data: null,
      error:
        sessionResult.error ??
        ({
          code: "missing_auth_session",
          message: "Log in again before requesting account deletion."
        } satisfies NormalizedSupabaseError)
    };
  }

  try {
    const response = await fetch(accountDeletionEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionResult.data.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ user_id: userId })
    });

    if (!response.ok) {
      return {
        data: null,
        error: {
          code: "account_deletion_request_failed",
          message: "Could not submit the deletion request.",
          status: response.status
        }
      };
    }

    return {
      data: { requested: true },
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: normalizeSupabaseError(error, "Could not submit the deletion request.")
    };
  }
}
