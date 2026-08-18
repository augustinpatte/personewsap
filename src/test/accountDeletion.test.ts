import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Account deletion is the one endpoint where a mistake destroys somebody else's
 * data, and the one the stores block a release on. Two things are checked here:
 * the authorisation properties of the function itself, and the schema contract
 * it relies on — that deleting the auth user really does remove every table of
 * personal data, and none of the shared editorial content.
 *
 * The function runs on Deno and cannot be imported here, so its guarantees are
 * asserted against its source. The cascade contract is asserted against the
 * migrations, which is where it actually lives.
 */

const repoRoot = join(__dirname, "..", "..");
const functionSource = readFileSync(
  join(repoRoot, "supabase", "functions", "delete-account", "index.ts"),
  "utf8"
);
const migrationsDir = join(repoRoot, "supabase", "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
  .join("\n");

describe("delete-account authorisation", () => {
  it("requires a bearer token", () => {
    expect(functionSource).toMatch(/Authorization/);
    expect(functionSource).toMatch(/bearer /i);
    expect(functionSource).toMatch(/401/);
  });

  it("derives the account from the verified token, never from the body", () => {
    // The identity used for the deletion.
    expect(functionSource).toMatch(/auth\.getUser\(\)/);
    expect(functionSource).toMatch(/deleteUser\(user\.id\)/);

    // Nothing in the function ever reads the request body.
    expect(functionSource).not.toMatch(/request\.json\(\)/);
    expect(functionSource).not.toMatch(/body\.user_id/);
    expect(functionSource).not.toMatch(/payload\.user_id/);
  });

  it("keeps the service-role key server-side only", () => {
    expect(functionSource).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);

    // The same key must not exist anywhere a client bundle can reach.
    const mobileEnvUsage = readFileSync(
      join(repoRoot, "apps", "mobile", "src", "lib", "supabase.ts"),
      "utf8"
    );

    expect(mobileEnvUsage).not.toMatch(/SERVICE_ROLE/);
  });

  it("rejects methods other than POST, and answers preflight", () => {
    expect(functionSource).toMatch(/method !== "POST"/);
    expect(functionSource).toMatch(/405/);
    expect(functionSource).toMatch(/OPTIONS/);
    expect(functionSource).toMatch(/Access-Control-Allow-Origin/);
  });

  it("does not echo an arbitrary origin back", () => {
    // A wildcard would let any site call this with a stolen session cookie.
    expect(functionSource).not.toMatch(/"Access-Control-Allow-Origin": "\*"/);
    expect(functionSource).toMatch(/ALLOWED_ORIGINS/);
  });
});

describe("the cascade the function relies on", () => {
  const userOwnedTables = [
    "user_preferences",
    "user_topic_preferences",
    "user_mini_case_topic_preferences",
    "daily_drops",
    "content_interactions",
    "mini_case_responses",
    "push_tokens",
    "push_notification_deliveries",
    "user_learning_paths",
    "learning_session_feedback"
  ];

  it("removes the profile when the auth user goes", () => {
    expect(migrations).toMatch(
      /id UUID PRIMARY KEY REFERENCES auth\.users\(id\) ON DELETE CASCADE/
    );
  });

  it.each(userOwnedTables)("cascades %s from the profile", (table) => {
    const definition = migrations.slice(
      migrations.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`)
    );
    const body = definition.slice(0, definition.indexOf(");"));

    expect(body).toMatch(/REFERENCES public\.profiles\(id\) ON DELETE CASCADE/);
  });

  it("cascades the rows hanging off those tables", () => {
    expect(migrations).toMatch(
      /daily_drop_id UUID NOT NULL REFERENCES public\.daily_drops\(id\) ON DELETE CASCADE/
    );
    expect(migrations).toMatch(
      /path_id UUID NOT NULL REFERENCES public\.user_learning_paths\(id\) ON DELETE CASCADE/
    );
    expect(migrations).toMatch(
      /session_id UUID NOT NULL UNIQUE REFERENCES public\.learning_sessions\(id\) ON DELETE CASCADE/
    );
  });

  it("deletes the legacy newsletter row the cascade cannot reach", () => {
    // profiles.legacy_user_id is ON DELETE SET NULL, so that row survives the
    // cascade and holds a name, an email and a phone number.
    expect(migrations).toMatch(
      /legacy_user_id UUID UNIQUE REFERENCES public\.users\(id\) ON DELETE SET NULL/
    );
    expect(functionSource).toMatch(/legacy_user_id/);
    expect(functionSource).toMatch(/from\("users"\)[\s\S]{0,80}\.delete\(\)/);
  });

  it("never deletes shared editorial content", () => {
    for (const shared of [
      "content_items",
      "sources",
      "content_item_sources",
      "topics",
      "learning_catalog_domains",
      "learning_domains",
      "learning_objectives"
    ]) {
      expect(functionSource).not.toMatch(new RegExp(`from\\("${shared}"\\)`));
    }
  });
});

describe("deployment is documented rather than assumed", () => {
  const readme = readFileSync(
    join(repoRoot, "supabase", "functions", "delete-account", "README.md"),
    "utf8"
  );

  it("names the exact command and the variable the owner must set", () => {
    expect(readme).toMatch(/supabase functions deploy delete-account/);
    expect(readme).toMatch(/ACCOUNT_DELETION_ALLOWED_ORIGINS/);
    expect(readme).toMatch(/EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT/);
  });
});
