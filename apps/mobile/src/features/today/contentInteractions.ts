import { clearMemoryCache } from "../../lib/memoryCache";
import { getAuthSession, normalizeSupabaseError, supabase } from "../../lib/supabase";
import type { NormalizedSupabaseError } from "../../lib/supabase";
import type { ContentInteraction, ContentRating, InteractionType } from "../../types/domain";

export type ContentInteractionSnapshot = {
  completedItemIds: Set<string>;
  savedItemIds: Set<string>;
  ratingsByItemId: Record<string, ContentRating>;
};

export type WriteContentInteractionParams = {
  contentItemId: string;
  interactionType: InteractionType;
  rating?: ContentRating;
  message?: string;
};

type ContentInteractionReadResult =
  | { ok: true; snapshot: ContentInteractionSnapshot }
  | { ok: false; error: NormalizedSupabaseError };

type WriteContentInteractionResult =
  | { ok: true }
  | { ok: false; error: NormalizedSupabaseError };

const persistedInteractionTypes = ["complete", "save", "feedback"] as const;

export async function readContentInteractionSnapshot(
  contentItemIds: string[]
): Promise<ContentInteractionReadResult> {
  if (contentItemIds.length === 0) {
    return { ok: true, snapshot: createEmptyContentInteractionSnapshot() };
  }

  if (!supabase) {
    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message:
          "Supabase is not configured. Previous content interactions cannot be loaded yet."
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
          message: "Sign in to load content interaction history."
        }
    };
  }

  try {
    const { data, error } = await supabase
      .from("content_interactions")
      .select("*")
      .eq("user_id", userId)
      .in("content_item_id", [...new Set(contentItemIds)])
      .in("interaction_type", [...persistedInteractionTypes])
      .order("created_at", { ascending: true });

    if (error) {
      return {
        ok: false,
        error: normalizeSupabaseError(error, "Could not load content interactions.")
      };
    }

    return {
      ok: true,
      snapshot: buildContentInteractionSnapshot(data ?? [])
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeSupabaseError(error, "Could not load content interactions.")
    };
  }
}

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

    if (error) {
      return { ok: false, error: normalizeSupabaseError(error) };
    }

    clearMemoryCache("library-drops");

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: normalizeSupabaseError(error, "Could not save this content interaction.")
    };
  }
}

export function createEmptyContentInteractionSnapshot(): ContentInteractionSnapshot {
  return {
    completedItemIds: new Set(),
    savedItemIds: new Set(),
    ratingsByItemId: {}
  };
}

function buildContentInteractionSnapshot(
  interactions: ContentInteraction[]
): ContentInteractionSnapshot {
  return interactions.reduce<ContentInteractionSnapshot>(
    (snapshot, interaction) => {
      if (interaction.interaction_type === "complete") {
        snapshot.completedItemIds.add(interaction.content_item_id);
      }

      if (interaction.interaction_type === "save") {
        snapshot.savedItemIds.add(interaction.content_item_id);
      }

      if (interaction.interaction_type === "feedback" && interaction.rating) {
        snapshot.ratingsByItemId[interaction.content_item_id] = interaction.rating;
      }

      return snapshot;
    },
    createEmptyContentInteractionSnapshot()
  );
}
