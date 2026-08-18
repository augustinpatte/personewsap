#!/usr/bin/env node
/**
 * End-to-end live proof of the catalog -> edition -> app circuit, in FR and EN.
 *
 * The Phase 1 report was honest that a catalog existed in principle but nothing
 * ever turned it into something a user could open. This script proves the whole
 * chain against the real project, without touching a real account:
 *
 *   disposable user -> profiles.language -> preferences -> published content
 *   -> personalize-test assignment -> daily_drops + daily_drop_items
 *   -> the exact query the mobile Today screen runs, under that user's own JWT
 *
 * It creates its own throwaway users, fully onboarded, runs the real
 * personalize-test CLI (never a reimplementation of it), verifies what comes
 * back, and deletes the users again.
 *
 * Usage:
 *   node scripts/live-edition-check.mjs
 *   node scripts/live-edition-check.mjs --keep-users   (leave them so you can log in manually)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const keepUsers = args.has("--keep-users");
const checks = [];

const mobileEnv = readEnvFile(path.join(ROOT, "apps/mobile/.env"));
const engineEnv = readEnvFile(path.join(ROOT, "services/content-engine/.env"));

const supabaseUrl = mobileEnv.EXPO_PUBLIC_SUPABASE_URL || engineEnv.SUPABASE_URL;
const anonKey = mobileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = engineEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  process.stderr.write("live-edition-check needs the mobile anon key and the server-side service-role key.\n");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const dropDate = process.env.DROP_DATE || productEditionDate();
const stamp = Date.now();
const createdUsers = [];

process.stdout.write("PersoNewsAP live edition circuit check (FR + EN)\n");
process.stdout.write("===============================================\n");
process.stdout.write(`drop date: ${dropDate}\n\n`);

try {
  for (const language of ["fr", "en"]) {
    await proveCircuitForLanguage(language);
  }
} catch (error) {
  fail("live-edition-check runner", error instanceof Error ? error.message : String(error));
} finally {
  if (!keepUsers) {
    for (const user of createdUsers) {
      await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
    }
    process.stdout.write(`\nDisposable users deleted (${createdUsers.length}).\n`);
  } else {
    process.stdout.write("\nDisposable users KEPT for manual app testing:\n");
    for (const user of createdUsers) {
      process.stdout.write(`  ${user.language}: ${user.email} / ${user.password}\n`);
    }
  }
  printSummary();
}

async function proveCircuitForLanguage(language) {
  process.stdout.write(`\n--- ${language.toUpperCase()} ---\n`);

  const email = `phase1b-edition-${language}+${stamp}@personewsap.test`;
  const password = `Phase1b-${stamp}-${language}!`;

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert(!created.error, `[${language}] create disposable user`, created.error?.message);
  const userId = created.data?.user?.id;
  if (!userId) {
    return;
  }
  createdUsers.push({ id: userId, email, password, language });

  // Full onboarding, written with service role so the test focuses on the
  // edition circuit rather than re-testing the onboarding writes.
  await admin.from("profiles").insert({ id: userId, email, language, timezone: "UTC" });
  await admin.from("user_preferences").upsert({
    user_id: userId,
    newsletter_enabled: true,
    business_stories_enabled: true,
    mini_cases_enabled: true,
    learning_path_enabled: false,
    learning_path_choice_completed: true,
    newsletter_article_count: 3
  });

  const topics = await topicsWithPublishedNewsletters(language);
  assert(topics.length > 0, `[${language}] published newsletter topics available`, `topics: ${topics.join(",")}`);

  await admin.from("user_topic_preferences").upsert(
    topics.slice(0, 3).map((topicId, index) => ({
      user_id: userId,
      topic_id: topicId,
      articles_count: 1,
      enabled: true,
      position: index + 1
    })),
    { onConflict: "user_id,topic_id" }
  );
  await admin.from("user_mini_case_topic_preferences").upsert(
    [{ user_id: userId, topic_id: "finance_economy", enabled: true, position: 1 }],
    { onConflict: "user_id,topic_id" }
  );

  const profileRow = await admin.from("profiles").select("language").eq("id", userId).maybeSingle();
  assert(
    profileRow.data?.language === language,
    `[${language}] profiles.language is '${language}'`,
    `actual: ${profileRow.data?.language}`
  );

  // The real CLI, targeted at exactly this user. No reimplementation.
  let cliOutput;
  try {
    cliOutput = execFileSync(
      "node",
      [path.join(ROOT, "services/content-engine/dist/cli.js"), "personalize-test", "--user-id", userId, "--date", dropDate],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SUPABASE_URL: supabaseUrl,
          SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
          CONFIRM_PERSONALIZE_TEST: "true"
        }
      }
    );
    pass(`[${language}] personalize-test CLI assigned an edition`);
  } catch (error) {
    fail(`[${language}] personalize-test CLI assigned an edition`, String(error.stderr || error.message).slice(0, 300));
    return;
  }

  const parsed = JSON.parse(cliOutput.slice(cliOutput.indexOf("{")));
  assert(
    parsed.assignedDropCount === 1,
    `[${language}] exactly one daily_drop created`,
    `assigned: ${parsed.assignedDropCount}, skipped: ${JSON.stringify(parsed.skippedUsers)}`
  );

  // Verify the stored rows.
  const drop = await admin
    .from("daily_drops")
    .select("id,drop_date,language,status")
    .eq("user_id", userId)
    .eq("drop_date", dropDate)
    .maybeSingle();
  assert(drop.data?.language === language, `[${language}] daily_drops.language is '${language}'`, `actual: ${drop.data?.language}`);
  assert(drop.data?.status === "published", `[${language}] daily_drops.status is published`, `actual: ${drop.data?.status}`);

  const items = await admin
    .from("daily_drop_items")
    .select("slot,position,content_item_id")
    .eq("daily_drop_id", drop.data.id);
  const slots = (items.data ?? []).map((item) => item.slot);
  assert(slots.includes("newsletter"), `[${language}] edition contains newsletter items`, `slots: ${slots.join(",")}`);
  assert(slots.includes("business_story"), `[${language}] edition contains a business story`, `slots: ${slots.join(",")}`);
  assert(slots.includes("mini_case"), `[${language}] edition contains a mini case`, `slots: ${slots.join(",")}`);

  const contentIds = (items.data ?? []).map((item) => item.content_item_id);
  const contents = await admin
    .from("content_items")
    .select("id,content_type,language,status,title")
    .in("id", contentIds);
  const wrongLanguage = (contents.data ?? []).filter((item) => item.language !== language);
  assert(
    wrongLanguage.length === 0,
    `[${language}] every linked content_item is in '${language}'`,
    `mismatched: ${wrongLanguage.length}`
  );
  const unpublished = (contents.data ?? []).filter((item) => item.status !== "published");
  assert(unpublished.length === 0, `[${language}] every linked content_item is published`, `unpublished: ${unpublished.length}`);

  process.stdout.write(`     edition content (${language}):\n`);
  for (const item of contents.data ?? []) {
    process.stdout.write(`       ${item.content_type.padEnd(19)} ${item.id}  ${String(item.title).slice(0, 62)}\n`);
  }

  // The decisive check: the exact query the mobile Today screen runs, executed
  // under the user's own JWT so assigned-content RLS is really exercised.
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  assert(!signIn.error, `[${language}] disposable user can sign in`, signIn.error?.message);

  const mobileDrop = await client
    .from("daily_drops")
    .select("id,drop_date,language,status")
    .eq("user_id", userId)
    .eq("drop_date", dropDate)
    .eq("language", language)
    .maybeSingle();
  assert(
    mobileDrop.data?.id === drop.data.id,
    `[${language}] Today query returns the edition through RLS`,
    mobileDrop.error ? describeError(mobileDrop.error) : `got: ${mobileDrop.data?.id ?? "null"}`
  );

  const mobileItems = await client
    .from("daily_drop_items")
    .select("slot,position,content_item_id")
    .eq("daily_drop_id", drop.data.id);
  assert(
    (mobileItems.data ?? []).length === (items.data ?? []).length,
    `[${language}] Reader can read every assigned item through RLS`,
    `mobile: ${(mobileItems.data ?? []).length}, stored: ${(items.data ?? []).length}`
  );

  const mobileContent = await client
    .from("content_items")
    .select("id,content_type,language,title,body_md")
    .in("id", contentIds);
  assert(
    (mobileContent.data ?? []).length === contentIds.length,
    `[${language}] assigned content_items readable under assigned-content RLS`,
    `readable: ${(mobileContent.data ?? []).length}/${contentIds.length}`
  );
  const emptyBodies = (mobileContent.data ?? []).filter((item) => !item.body_md || item.body_md.trim().length === 0);
  assert(emptyBodies.length === 0, `[${language}] every assigned item has a readable body`, `empty: ${emptyBodies.length}`);

  await proveLanguageSwitchRebuildsEdition({ client, userId, language, existingDropId: drop.data.id });
}

/**
 * The scenario that made the product feel broken: the user switches language,
 * Today filters editions by language, and the edition assigned earlier that day
 * is still in the old language — so the day looks empty. Assignment must rebuild
 * a stale-language edition instead of skipping it.
 */
async function proveLanguageSwitchRebuildsEdition({ client, userId, language, existingDropId }) {
  const otherLanguage = language === "fr" ? "en" : "fr";

  const switched = await client.rpc("update_profile_language", { p_language: otherLanguage });
  assert(!switched.error, `[${language}] switch profile language to '${otherLanguage}'`, describeError(switched.error));

  // Today's query, in the new language, must find nothing yet: the stored edition
  // is still in the old language.
  const staleLookup = await client
    .from("daily_drops")
    .select("id")
    .eq("user_id", userId)
    .eq("drop_date", dropDate)
    .eq("language", otherLanguage)
    .maybeSingle();
  assert(
    !staleLookup.data,
    `[${language}] Today is empty right after the switch (edition still in '${language}')`,
    `unexpected drop: ${staleLookup.data?.id}`
  );

  try {
    execFileSync(
      "node",
      [path.join(ROOT, "services/content-engine/dist/cli.js"), "personalize-test", "--user-id", userId, "--date", dropDate],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SUPABASE_URL: supabaseUrl,
          SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
          CONFIRM_PERSONALIZE_TEST: "true"
        }
      }
    );
    pass(`[${language}] re-running assignment after the switch`);
  } catch (error) {
    fail(`[${language}] re-running assignment after the switch`, String(error.stderr || error.message).slice(0, 300));
    return;
  }

  const rebuilt = await client
    .from("daily_drops")
    .select("id,language")
    .eq("user_id", userId)
    .eq("drop_date", dropDate)
    .maybeSingle();
  assert(
    rebuilt.data?.language === otherLanguage,
    `[${language}] the day's edition was rebuilt in '${otherLanguage}'`,
    `language: ${rebuilt.data?.language}`
  );
  assert(
    rebuilt.data?.id === existingDropId,
    `[${language}] rebuild reuses the same daily_drop row (one edition per user/day)`,
    `id changed: ${rebuilt.data?.id !== existingDropId}`
  );

  const rebuiltItems = await client
    .from("daily_drop_items")
    .select("content_item_id")
    .eq("daily_drop_id", rebuilt.data.id);
  const rebuiltContent = await client
    .from("content_items")
    .select("language")
    .in("id", (rebuiltItems.data ?? []).map((item) => item.content_item_id));
  const wrong = (rebuiltContent.data ?? []).filter((item) => item.language !== otherLanguage);
  assert(
    wrong.length === 0 && (rebuiltContent.data ?? []).length > 0,
    `[${language}] rebuilt edition contains only '${otherLanguage}' content`,
    `items: ${(rebuiltContent.data ?? []).length}, wrong: ${wrong.length}`
  );

  // Restore the account to the language it is labelled with, and rebuild its
  // edition, so a kept user is coherent for manual testing.
  await client.rpc("update_profile_language", { p_language: language });
  execFileSync(
    "node",
    [path.join(ROOT, "services/content-engine/dist/cli.js"), "personalize-test", "--user-id", userId, "--date", dropDate],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
        CONFIRM_PERSONALIZE_TEST: "true"
      }
    }
  );

  const restored = await client
    .from("daily_drops")
    .select("language")
    .eq("user_id", userId)
    .eq("drop_date", dropDate)
    .maybeSingle();
  assert(
    restored.data?.language === language,
    `[${language}] account restored to '${language}' with a matching edition`,
    `language: ${restored.data?.language}`
  );
}

async function topicsWithPublishedNewsletters(language) {
  const { data } = await admin
    .from("content_items")
    .select("topic_id")
    .eq("content_type", "newsletter_article")
    .eq("language", language)
    .eq("status", "published")
    .lte("publication_date", dropDate)
    .limit(500);

  return [...new Set((data ?? []).map((row) => row.topic_id).filter(Boolean))];
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
  return error ? `${error.code ?? "?"}: ${error.message}` : undefined;
}

function assert(condition, label, details) {
  if (condition) {
    pass(label);
    return;
  }
  fail(label, details);
}

function pass(label, details) {
  checks.push({ status: "PASS", label });
  process.stdout.write(`PASS ${label}${details ? ` — ${details}` : ""}\n`);
}

function fail(label, details) {
  checks.push({ status: "FAIL", label });
  process.stdout.write(`FAIL ${label}${details ? ` — ${details}` : ""}\n`);
}

function printSummary() {
  const failed = checks.filter((check) => check.status === "FAIL").length;
  const passed = checks.filter((check) => check.status === "PASS").length;
  process.stdout.write(`\nSummary: ${passed} pass, ${failed} fail\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

/**
 * Today's editorial date in the single product timezone (Europe/Paris), the
 * same value the app and the content engine resolve. Never UTC or the runner's
 * local zone: those disagree with the app for an hour or two every night.
 */
function productEditionDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
