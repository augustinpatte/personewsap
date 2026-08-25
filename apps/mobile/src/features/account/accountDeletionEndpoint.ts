/**
 * Where the account-deletion request goes.
 *
 * `EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT` still wins, so a custom domain or a
 * proxy in front of the function keeps working. When it is unset the endpoint
 * is derived from the Supabase URL, because a deployed Edge Function always
 * lives at `<project-url>/functions/v1/<slug>` — the explicit variable was
 * restating something the build already knows.
 *
 * That derivation is the difference between a build that can delete accounts
 * and one that reports deletion as unavailable, which both stores require.
 * The result is still "" when neither value is usable, so the caller's
 * `account_deletion_endpoint_missing` path is unchanged.
 *
 * Kept in its own module, free of imports, so it can be tested without
 * constructing a Supabase client.
 */
export function resolveAccountDeletionEndpoint(
  explicitEndpoint: string | undefined,
  supabaseUrl: string | undefined
): string {
  const override = explicitEndpoint?.trim() ?? "";

  if (override) {
    return override;
  }

  const base = supabaseUrl?.trim() ?? "";

  if (!base) {
    return "";
  }

  try {
    const parsed = new URL(base);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }

    return `${base.replace(/\/+$/, "")}/functions/v1/delete-account`;
  } catch {
    return "";
  }
}
