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
    logContentInteractionProof("interaction_snapshot_empty", {
      reason: "no_content_item_ids"
    });

    return { ok: true, snapshot: createEmptyContentInteractionSnapshot() };
  }

  if (!supabase) {
    logContentInteractionProof("interaction_snapshot_failed", {
      reason: "missing_supabase_config"
    });

    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: "Live progress is not configured yet.",
        hint:
          "Developer/Test info: configure the public live-data env vars to load saved progress."
      }
    };
  }

  const sessionResult = await getAuthSession();
  const userId = sessionResult.data?.user.id;

  if (sessionResult.error || !userId) {
    logContentInteractionProof("interaction_snapshot_failed", {
      reason: "missing_auth_session"
    });

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
      logContentInteractionProof("interaction_snapshot_failed", {
        content_item_count: contentItemIds.length,
        reason: "supabase_error",
        user_id: userId ? redactIdentifier(userId) : null
      });

      return {
        ok: false,
        error: normalizeSupabaseError(error, "Could not load content interactions.")
      };
    }

    logContentInteractionProof("interaction_snapshot_loaded", {
      content_item_count: contentItemIds.length,
      interaction_count: data?.length ?? 0,
      user_id: redactIdentifier(userId)
    });

    return {
      ok: true,
      snapshot: buildContentInteractionSnapshot(data ?? [])
    };
  } catch (error) {
    logContentInteractionProof("interaction_snapshot_failed", {
      content_item_count: contentItemIds.length,
      reason: "supabase_error",
      user_id: userId ? redactIdentifier(userId) : null
    });

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
    logContentInteractionProof("interaction_write_failed", {
      interaction_type: interactionType,
      reason: "missing_supabase_config"
    });

    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: "This action can only be saved on this device for now.",
        hint:
          "Developer/Test info: configure the public live-data env vars to save progress to the account."
      }
    };
  }

  const sessionResult = await getAuthSession();
  const userId = sessionResult.data?.user.id;

  if (sessionResult.error || !userId) {
    logContentInteractionProof("interaction_write_failed", {
      interaction_type: interactionType,
      reason: "missing_auth_session"
    });

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
      logContentInteractionProof("interaction_write_failed", {
        content_item_id: redactIdentifier(contentItemId),
        interaction_type: interactionType,
        reason: "supabase_error",
        user_id: redactIdentifier(userId)
      });

      return { ok: false, error: normalizeSupabaseError(error) };
    }

    clearMemoryCache("library-drops");

    logContentInteractionProof("interaction_write_success", {
      content_item_id: redactIdentifier(contentItemId),
      interaction_type: interactionType,
      rating: rating ?? null,
      user_id: redactIdentifier(userId)
    });

    return { ok: true };
  } catch (error) {
    logContentInteractionProof("interaction_write_failed", {
      content_item_id: redactIdentifier(contentItemId),
      interaction_type: interactionType,
      reason: "supabase_error",
      user_id: userId ? redactIdentifier(userId) : null
    });

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

function logContentInteractionProof(
  event:
    | "interaction_snapshot_empty"
    | "interaction_snapshot_failed"
    | "interaction_snapshot_loaded"
    | "interaction_write_failed"
    | "interaction_write_success",
  details: Record<string, unknown>
): void {
  if (__DEV__) {
    console.info("[Content interaction proof]", {
      event,
      ...details
    });
  }
}

function redactIdentifier(identifier: string): string {
  return identifier.length <= 8
    ? identifier
    : `${identifier.slice(0, 4)}...${identifier.slice(-4)}`;
}
