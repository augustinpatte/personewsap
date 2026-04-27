import { getAuthSession, normalizeSupabaseError, supabase } from "../../lib/supabase";
import type { NormalizedSupabaseError } from "../../lib/supabase";
import type { ContentRating, InteractionType } from "../../types/domain";

type WriteContentInteractionParams = {
  contentItemId: string;
  interactionType: InteractionType;
  rating?: ContentRating;
  message?: string;
};

type WriteContentInteractionResult =
  | { ok: true }
  | { ok: false; error: NormalizedSupabaseError };

export async function writeContentInteraction({
  contentItemId,
  interactionType,
  rating,
  message
}: WriteContentInteractionParams): Promise<WriteContentInteractionResult> {
  if (!supabase) {
    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message:
          "Supabase is not configured. This action can only be saved locally for now."
      }
    };
  }

  const sessionResult = await getAuthSession();
  const userId = sessionResult.data?.user.id;

  if (sessionResult.error || !userId) {
    return {
      ok: false,
      error:
        sessionResult.error ?? {
          code: "missing_auth_session",
          message: "Sign in before saving content interactions."
        }
    };
  }

  try {
    const { error } = await supabase.from("content_interactions").insert({
      user_id: userId,
      content_item_id: contentItemId,
      interaction_type: interactionType,
      rating,
      message
    });

    return error
      ? { ok: false, error: normalizeSupabaseError(error) }
      : { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: normalizeSupabaseError(error, "Could not save this content interaction.")
    };
  }
}
