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
 * The one thing the cascade does not cover is the legacy web newsletter row
 * (public.users), which profiles references with ON DELETE SET NULL. It holds a
 * name, an email and a phone number, so it is removed explicitly.
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

  // Read the legacy link before the cascade removes the profile row.
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("legacy_user_id")
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

  const legacyUserId = (profile as { legacy_user_id: string | null } | null)?.legacy_user_id ?? null;

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

  let legacyDeleted = false;

  if (legacyUserId) {
    const { error: legacyError } = await adminClient
      .from("users")
      .delete()
      .eq("id", legacyUserId);

    if (legacyError) {
      // The account itself is gone; the legacy subscriber row is not. Reported
      // rather than hidden, so it can be cleaned up, but the caller is not told
      // the deletion failed — because it did not.
      console.error("delete-account left a legacy row behind", legacyError.message);
    } else {
      legacyDeleted = true;
    }
  }

  return jsonResponse(
    {
      ok: true,
      deleted: true,
      legacy_newsletter_record_deleted: legacyDeleted
    },
    200,
    origin
  );
});
