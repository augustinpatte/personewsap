#!/usr/bin/env node
/**
 * Authenticated live integration check.
 *
 * The existing harnesses cover two things well: Vitest covers pure logic with
 * mocks, and backend-e2e covers the service-role content pipeline. Neither ever
 * exercises the app's real path — an authenticated user hitting Supabase through
 * RLS with an anon-key JWT. That gap is why unit tests stayed green while
 * language switching and preference saving were broken in the real product.
 *
 * This script closes it. It creates a DISPOSABLE user, signs in as that user,
 * runs the exact reads/writes the mobile app performs, verifies the values that
 * come back, and deletes the user again. It never touches a real user's data.
 *
 * Usage:
 *   node scripts/live-auth-check.mjs
 *   node scripts/live-auth-check.mjs --keep-user   (leave the disposable user for manual app testing)
 *
 * Credentials come from apps/mobile/.env (anon key, the same one the app ships)
 * and services/content-engine/.env (service-role key, server-side only). No
 * secret is ever printed.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const keepUser = args.has("--keep-user");
const checks = [];

const mobileEnv = readEnvFile(path.join(ROOT, "apps/mobile/.env"));
const engineEnv = readEnvFile(path.join(ROOT, "services/content-engine/.env"));

const supabaseUrl = mobileEnv.EXPO_PUBLIC_SUPABASE_URL || engineEnv.SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = mobileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = engineEnv.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  process.stderr.write(
    "live-auth-check needs EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY (apps/mobile/.env) and SUPABASE_SERVICE_ROLE_KEY (services/content-engine/.env).\n"
  );
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const stamp = Date.now();
const testEmail = `phase1b-live-check+${stamp}@personewsap.test`;
const testPassword = `Phase1b-${stamp}-check!`;
let userId = null;

printHeader();

try {
  await main();
} catch (error) {
  fail("live-auth-check runner", error instanceof Error ? error.message : String(error));
} finally {
  if (userId && !keepUser) {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    process.stdout.write(`\nDisposable user deleted (${redact(userId)}).\n`);
  } else if (userId) {
    process.stdout.write(`\nDisposable user KEPT for manual testing: ${testEmail} / ${testPassword}\n`);
  }
  printSummary();
}

async function main() {
  // 1. Disposable, auto-confirmed user.
  const created = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true
  });
  assert(!created.error, "create disposable auth user", created.error?.message);
  userId = created.data?.user?.id ?? null;
  assert(Boolean(userId), "disposable user has an id");

  // 2. Sign in exactly like the app does: anon key, real JWT, RLS enforced.
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email: testEmail, password: testPassword });
  assert(!signIn.error, "sign in with anon key (RLS path)", signIn.error?.message);

  // 3. Profile bootstrap, mirroring AuthProvider.createProfileIfMissing.
  const insertProfile = await client.from("profiles").insert({
    id: userId,
    email: testEmail,
    language: "en",
    timezone: "UTC"
  });
  assert(!insertProfile.error, "authenticated user can create own profile", describeError(insertProfile.error));

  // 4. THE LANGUAGE PATH: the RPC the Account screen calls.
  for (const language of ["fr", "en", "fr"]) {
    const rpc = await client.rpc("update_profile_language", { p_language: language });
    assert(
      !rpc.error,
      `update_profile_language('${language}') RPC succeeds`,
      rpc.error ? `${rpc.error.code ?? "?"}: ${rpc.error.message}` : undefined
    );

    if (!rpc.error) {
      const readBack = await client.from("profiles").select("language").eq("id", userId).maybeSingle();
      assert(
        readBack.data?.language === language,
        `profiles.language persisted as '${language}'`,
        `read back: ${readBack.data?.language ?? "null"}`
      );
    }
  }

  // 5. Learning-path language sync: an active path must follow the profile.
  const objective = await anyLearningObjective();
  const pathInsert = objective
    ? await admin
        .from("user_learning_paths")
        .insert({
          user_id: userId,
          domain_id: objective.domain_id,
          objective_id: objective.id,
          language: "en",
          status: "active",
          current_level: 1,
          target_level: 3
        })
        .select("id")
        .maybeSingle()
    : { error: { code: "no_objective", message: "no learning objective seeded" }, data: null };

  if (pathInsert.error) {
    skip("learning path language sync", `could not seed a path: ${describeError(pathInsert.error)}`);
  } else {
    const switchToFr = await client.rpc("update_profile_language", { p_language: "fr" });
    assert(!switchToFr.error, "language switch with an active learning path", describeError(switchToFr.error));

    const pathAfter = await admin
      .from("user_learning_paths")
      .select("language,status")
      .eq("id", pathInsert.data.id)
      .maybeSingle();
    assert(
      pathAfter.data?.language === "fr",
      "active learning path follows the new profile language",
      `path language: ${pathAfter.data?.language ?? "null"}`
    );

    const switchBack = await client.rpc("update_profile_language", { p_language: "en" });
    assert(!switchBack.error, "language switch back to en", describeError(switchBack.error));
    const pathBack = await admin
      .from("user_learning_paths")
      .select("language")
      .eq("id", pathInsert.data.id)
      .maybeSingle();
    assert(
      pathBack.data?.language === "en",
      "active learning path follows a second language switch",
      `path language: ${pathBack.data?.language ?? "null"}`
    );
  }

  // 6. THE PREFERENCES PATH, including the "newsletter disabled" case that the
  //    app allows but the newsletter_article_count CHECK rejects when it is 0.
  await checkPreferencesSave(client, "all modules enabled", {
    newsletter_enabled: true,
    business_stories_enabled: true,
    mini_cases_enabled: true,
    learning_path_enabled: true,
    learning_path_choice_completed: true,
    newsletter_article_count: 4
  });

  // Newsletter disabled: no topics are selected, so the client's computed total is
  // 0. Sending 0 violates the BETWEEN 1 AND 24 CHECK, so the client clamps to the
  // schema minimum (toStorableNewsletterArticleCount).
  await checkPreferencesSave(client, "newsletter module disabled (clamped count)", {
    newsletter_enabled: false,
    business_stories_enabled: true,
    mini_cases_enabled: true,
    learning_path_enabled: false,
    learning_path_choice_completed: true,
    newsletter_article_count: 1
  });

  const rawZero = await client
    .from("user_preferences")
    .upsert({ user_id: userId, newsletter_enabled: false, newsletter_article_count: 0 });
  assert(
    Boolean(rawZero.error),
    "unclamped count 0 is still rejected by the database (constraint intact)",
    rawZero.error ? undefined : "expected 23514 but the write succeeded"
  );

  // 7. Topic + mini-case preference upserts, exactly as the client sends them.
  // Positions are 1-based, matching buildNewsletterTopicPreferenceRows /
  // buildMiniCaseTopicPreferenceRows and the BETWEEN 1 AND 8 CHECK constraints.
  const topicRows = [
    { user_id: userId, topic_id: "business", articles_count: 2, enabled: true, position: 1 },
    { user_id: userId, topic_id: "finance", articles_count: 1, enabled: true, position: 2 }
  ];
  const topicUpsert = await client
    .from("user_topic_preferences")
    .upsert(topicRows, { onConflict: "user_id,topic_id" });
  assert(!topicUpsert.error, "upsert newsletter topic preferences", describeError(topicUpsert.error));

  const miniCaseRows = [
    { user_id: userId, topic_id: "finance_economy", enabled: true, position: 1 },
    { user_id: userId, topic_id: "ai", enabled: true, position: 2 }
  ];
  const miniCaseUpsert = await client
    .from("user_mini_case_topic_preferences")
    .upsert(miniCaseRows, { onConflict: "user_id,topic_id" });
  assert(!miniCaseUpsert.error, "upsert mini-case topic preferences", describeError(miniCaseUpsert.error));

  // 8. Read back through RLS and compare with what was requested.
  const readTopics = await client
    .from("user_topic_preferences")
    .select("topic_id,articles_count,enabled")
    .eq("user_id", userId);
  assert(
    (readTopics.data ?? []).length === 2,
    "newsletter topic preferences survive a reload",
    `rows: ${(readTopics.data ?? []).length}`
  );

  const readMiniCase = await client
    .from("user_mini_case_topic_preferences")
    .select("topic_id,enabled")
    .eq("user_id", userId);
  assert(
    (readMiniCase.data ?? []).length === 2,
    "mini-case topic preferences survive a reload",
    `rows: ${(readMiniCase.data ?? []).length}`
  );

  // 9. Assigned-content RLS: the user must be able to read a drop assigned to it.
  const assigned = await client
    .from("daily_drops")
    .select("id,drop_date,language,status")
    .eq("user_id", userId);
  assert(!assigned.error, "authenticated user can query own daily_drops", describeError(assigned.error));
}

async function checkPreferencesSave(client, label, payload) {
  const result = await client.from("user_preferences").upsert({ user_id: userId, ...payload });
  assert(!result.error, `save preferences: ${label}`, describeError(result.error));

  if (result.error) {
    return;
  }

  const readBack = await client
    .from("user_preferences")
    .select("newsletter_enabled,business_stories_enabled,mini_cases_enabled,learning_path_enabled,newsletter_article_count")
    .eq("user_id", userId)
    .maybeSingle();

  const matches =
    readBack.data?.newsletter_enabled === payload.newsletter_enabled &&
    readBack.data?.business_stories_enabled === payload.business_stories_enabled &&
    readBack.data?.mini_cases_enabled === payload.mini_cases_enabled &&
    readBack.data?.learning_path_enabled === payload.learning_path_enabled;

  assert(matches, `preferences read back match what was saved: ${label}`, JSON.stringify(readBack.data));
}

async function anyLearningObjective() {
  const { data } = await admin
    .from("learning_objectives")
    .select("id,domain_id")
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

function describeError(error) {
  if (!error) {
    return undefined;
  }
  return `${error.code ?? "?"}: ${error.message}${error.details ? ` (${error.details})` : ""}`;
}

function redact(value) {
  return String(value).length <= 8 ? String(value) : `${String(value).slice(0, 4)}...${String(value).slice(-4)}`;
}

function assert(condition, label, details) {
  if (condition) {
    pass(label);
    return;
  }
  fail(label, details);
}

function pass(label, details) {
  checks.push({ status: "PASS", label, details });
  process.stdout.write(`PASS ${label}${details ? ` — ${details}` : ""}\n`);
}

function fail(label, details) {
  checks.push({ status: "FAIL", label, details });
  process.stdout.write(`FAIL ${label}${details ? ` — ${details}` : ""}\n`);
}

function skip(label, details) {
  checks.push({ status: "SKIP", label, details });
  process.stdout.write(`SKIP ${label}${details ? ` — ${details}` : ""}\n`);
}

function printHeader() {
  process.stdout.write("PersoNewsAP authenticated live integration check\n");
  process.stdout.write("================================================\n");
  process.stdout.write(`project: ${supabaseUrl.replace(/https:\/\/([^.]{4})[^.]*/, "https://$1***")}\n`);
  process.stdout.write(`disposable user: ${testEmail}\n\n`);
}

function printSummary() {
  const failed = checks.filter((check) => check.status === "FAIL").length;
  const passed = checks.filter((check) => check.status === "PASS").length;
  const skipped = checks.filter((check) => check.status === "SKIP").length;

  process.stdout.write(`\nSummary: ${passed} pass, ${failed} fail, ${skipped} skip\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}
