import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

/**
 * Account deletion.
 *
 * A store requirement, and the one endpoint where getting authorisation wrong
 * destroys someone else's data. The rules it enforces:
 *
 *  - a JWT is mandatory, and the caller's identity comes only from it. The
 *    request body is never trusted: a user_id in the payload is ignored
 *    outright, so no one can pass another account's id and have it deleted;
 *  - the service-role key lives here and nowhere else. It is what allows
 *    deleting an auth user, and it must never exist in the mobile or web app;
 *  - deletion is scoped to the caller's own row by construction — the id passed
 *    to the admin API is the one the JWT resolved to.
 *
 * What disappears is decided by the schema, not by a list maintained here:
 * auth.users cascades to public.profiles, which cascades to every table that
 * owns user data (preferences, both topic preference tables, daily drops and
 * their items, content interactions, mini-case responses, push tokens and their
 * delivery records, learning paths, sessions and feedback). Writing an explicit
 * DELETE per table would duplicate that contract and silently rot as tables are
 * added.
 *
 * Two things the cascade does not cover, and both are removed explicitly
 * BEFORE the auth user goes:
 *
 *  - the legacy web newsletter row (public.users), which profiles references
 *    with ON DELETE SET NULL. It holds a name, an email and a phone number;
 *
 *  - the reader's AVATAR OBJECTS in Storage. A cascade in Postgres cannot reach
 *    an object in a bucket, so deleting the account used to leave a photograph
 *    of the person on the server with the row that pointed at it gone — an
 *    orphan nothing would ever collect, which is precisely the file a deletion
 *    request is most obviously about.
 *
 * BOTH FAIL CLOSED. If Storage refuses, this returns 500 and the auth user is
 * left untouched, so the reader keeps their session and can retry. That is the
 * deliberate trade: a deletion that reports success must mean the personal data
 * is gone, and a retryable failure is a far smaller harm than a silent one. The
 * alternative — delete the account and log the orphan — makes "deleted" a claim
 * the server cannot back up.
 *
 * Shared editorial data — content_items, sources, content_item_sources, topics,
 * the learning catalog — is never touched: it belongs to the product, not to a
 * reader.
 */

const ALLOWED_ORIGINS = (Deno.env.get("ACCOUNT_DELETION_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

function corsHeaders(origin: string | null): Record<string, string> {
  // Echo only an origin that was explicitly allowed. With none configured the
  // endpoint still works for the mobile app (which sends no Origin) while no
  // arbitrary website can call it from a browser with a stolen session.
  const allowOrigin =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) }
  });
}

type AvatarRemoval =
  | { ok: true; removed: number }
  | { ok: false; reason: string };

/**
 * Take every avatar object this reader owns out of the bucket.
 *
 * The listing is the authority, not `profiles.avatar_path`. A replace is two
 * operations — upload the new object, then point the row at it — and a crash
 * between them leaves an object the row never named. Those files are the same
 * person's photograph and nothing else will ever look for them, so the sweep is
 * by folder, with the stored path folded in as a belt-and-braces entry in case
 * the listing is stale.
 *
 * `list()` returns one page of up to 100 by default; the loop pages until a
 * short page comes back, so a reader who changed their photo two hundred times
 * is still cleared completely. An empty folder is a success, not an error: a
 * reader who never opened Teams has no avatar to delete.
 */
async function removeAvatarObjects(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  storedPath: string | null
): Promise<AvatarRemoval> {
  const bucket = adminClient.storage.from("avatars");
  const pageSize = 100;
  const names = new Set<string>();

  // A path written by an older build may carry the bucket name; the object is
  // addressed without it. Normalising here means a legacy row still resolves to
  // a real object instead of being quietly skipped.
  const normalizedStored = (storedPath ?? "").trim().replace(/^avatars\//, "");

  if (normalizedStored.length > 0 && normalizedStored.startsWith(`${userId}/`)) {
    names.add(normalizedStored);
  }

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(userId, { limit: pageSize, offset });

    if (error) {
      // Fail closed. The caller turns this into a 500 and the auth user is left
      // alone, so the reader can retry rather than being told their data is
      // gone when a photograph of them is still on the server.
      return { ok: false, reason: error.message };
    }

    const page = data ?? [];

    for (const entry of page) {
      if (entry?.name) {
        names.add(`${userId}/${entry.name}`);
      }
    }

    if (page.length < pageSize) {
      break;
    }
  }

  if (names.size === 0) {
    return { ok: true, removed: 0 };
  }

  const { error: removeError } = await bucket.remove([...names]);

  if (removeError) {
    return { ok: false, reason: removeError.message };
  }

  return { ok: true, removed: names.size };
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "method_not_allowed", message: "Use POST." },
      405,
      origin
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("delete-account is missing its environment configuration");

    return jsonResponse(
      {
        ok: false,
        error: "not_configured",
        message: "Account deletion is not configured on the server."
      },
      500,
      origin
    );
  }

  const authorization = request.headers.get("Authorization") ?? "";

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return jsonResponse(
      {
        ok: false,
        error: "unauthorized",
        message: "Sign in again, then retry the deletion."
      },
      401,
      origin
    );
  }

  // Identity comes from the token, verified by Supabase — never from the body.
  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } }
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return jsonResponse(
      {
        ok: false,
        error: "unauthorized",
        message: "Sign in again, then retry the deletion."
      },
      401,
      origin
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Read what the cascade cannot reach, before the profile row is gone.
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("legacy_user_id,avatar_path")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("delete-account could not read the profile", profileError.message);

    return jsonResponse(
      {
        ok: false,
        error: "profile_read_failed",
        message: "Your account was not deleted. Please try again."
      },
      500,
      origin
    );
  }

  const profileRow = profile as
    | { legacy_user_id: string | null; avatar_path: string | null }
    | null;

  const legacyUserId = profileRow?.legacy_user_id ?? null;

  // The whole folder, not just the path the profile happens to point at. An
  // upload that succeeded while the profile update that followed it failed
  // leaves an object nothing references; those are this reader's photographs
  // too, and this is the only moment anything will ever look for them.
  const avatarRemoval = await removeAvatarObjects(adminClient, user.id, profileRow?.avatar_path ?? null);

  if (!avatarRemoval.ok) {
    console.error("delete-account could not clear the avatar objects", avatarRemoval.reason);

    return jsonResponse(
      {
        ok: false,
        error: "avatar_cleanup_failed",
        message: "Your account was not deleted. Please try again."
      },
      500,
      origin
    );
  }

  let legacyDeleted = false;

  if (legacyUserId) {
    const { error: legacyError } = await adminClient
      .from("users")
      .delete()
      .eq("id", legacyUserId);

    if (legacyError) {
      // Abort before auth deletion. A success response must mean the account
      // and the linked legacy personal-data row are both gone.
      console.error("delete-account could not delete the legacy row", legacyError.message);

      return jsonResponse(
        {
          ok: false,
          error: "legacy_delete_failed",
          message: "Your account was not deleted. Please try again."
        },
        500,
        origin
      );
    } else {
      legacyDeleted = true;
    }
  }

  // The whole deletion: auth.users cascades through public.profiles into every
  // table that owns this reader's data.
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);

  if (deleteError) {
    console.error("delete-account could not delete the auth user", deleteError.message);

    return jsonResponse(
      {
        ok: false,
        error: "deletion_failed",
        message: "Your account was not deleted. Please try again."
      },
      500,
      origin
    );
  }

  return jsonResponse(
    {
      ok: true,
      deleted: true,
      legacy_newsletter_record_deleted: legacyDeleted,
      avatar_objects_deleted: avatarRemoval.removed
    },
    200,
    origin
  );
});
