#!/usr/bin/env node
/**
 * The whole product, end to end, on two local Supabase stacks.
 *
 *   npm run teams:test:e2e:local
 *
 * WHAT THIS IS FOR
 *
 * The SQL suites prove contracts inside one transaction that rolls back. This
 * proves the thing they cannot: that a batch generated in staging becomes a
 * published edition in production, that the edition is assigned to real readers
 * and real Teams, and that those readers — holding real JWTs minted by a real
 * Auth server — can play it and be scored.
 *
 * Nothing here is rolled back. It runs against local containers that
 * `supabase db reset` throws away, and it starts by resetting both of them, so
 * every run begins from the migrations and nothing else.
 *
 * TWO STACKS, ONE PAYLOAD
 *
 * The staging project and the production project are separate databases in
 * production and separate Docker stacks here, so nothing carries a payload
 * between them automatically — in production that is the publisher Edge
 * Function's job. This script is that transport: it asks the staging stack for
 * `get_scheduled_edition_publish_plan`, takes the `ready_payload` byte for
 * byte, and hands it to the production stack's `publish_scheduled_staging_payload`
 * exactly as supabase/functions/personews-task-publisher does. The payload is
 * not synthesised here; it is whatever the staging gate approved.
 *
 * NO REMOTE. Every URL is 127.0.0.1 and every key comes from `supabase status`.
 * There is no code path in this file that can reach api.supabase.com or a
 * hosted project, whatever SUPABASE_ACCESS_TOKEN happens to hold.
 */

import { spawn } from "node:child_process";

import { dbContainer, runSql, runSqlFiles, stackEnv } from "./lib/local-db.mjs";

const STAGING_WORKDIR = "supabase-staging";
const PRODUCTION_REF = "wkbviidrbmehmjbhvpeh";

const FIXTURE = "supabase-staging/supabase/tests/lib/edition_fixture.sql";
const HARNESS = "supabase-staging/supabase/tests/local_harness.sql";
const EMIT = "supabase-staging/supabase/tests/lib/e2e_emit_payload.sql";

// Two consecutive publishing days. E1 is the edition that is open while the
// Teams are created, E2 the one they are first eligible for — which is the
// whole mid-edition rule (§5, §12) and cannot be tested with a single edition.
// Both are Wednesdays/Fridays in a year no real batch occupies.
const E1 = "2027-04-07"; // Wednesday
const E2 = "2027-04-09"; // Friday

const skipReset = process.argv.includes("--no-reset");

// Readers are addressed by email, and Auth refuses a duplicate. A run tag keeps
// --no-reset (the iteration path, which leaves the databases standing) from
// colliding with the run before it.
const runTag = skipReset ? `${Date.now()}.` : "";
const readerEmail = (name) => `${name}.${runTag}e2e@personews.test`;

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const results = [];
let phase = "";

function section(name) {
  phase = name;
  console.log(`\n── ${name}`);
}

function check(test, expected, observed) {
  const pass = String(expected) === String(observed);
  results.push({ phase, test, expected: String(expected), observed: String(observed), pass });
  console.log(`   ${pass ? "✓" : "✗"} ${test}`);
  if (!pass) console.log(`       expected ${expected}\n       observed ${observed}`);
  return pass;
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function shell(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

async function reset(workdir) {
  const args = ["db", "reset"];
  if (workdir) args.push("--workdir", workdir);
  const { code, err, out } = await shell("supabase", args);
  if (code !== 0) throw new Error(`supabase ${args.join(" ")} failed:\n${err || out}`);
}

/** One value out of the production database, as postgres. */
async function scalar(sql, variables) {
  const result = await runSql(sql, { container: prodContainer, variables });
  if (!result.ok) throw new Error(`${sql.slice(0, 120)}…\n${result.stderr}`);
  return result.rows.at(-1)?.[0] ?? "";
}

async function stagingScalar(sql, variables) {
  const result = await runSql(sql, { container: stagingContainer, variables });
  if (!result.ok) throw new Error(`${sql.slice(0, 120)}…\n${result.stderr}`);
  return result.rows.at(-1)?.[0] ?? "";
}

/**
 * A PostgREST call as a specific reader, with that reader's real access token.
 *
 * This is the point of using the Auth server rather than set_config: the token
 * is signed by GoTrue, verified by PostgREST, and auth.uid() inside every RPC
 * and every policy is derived from it the same way it is on a phone.
 */
async function rpc(actor, fn, body = {}) {
  const response = await fetch(`${prod.API_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: prod.ANON_KEY,
      authorization: `Bearer ${actor.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { ok: response.ok, status: response.status, data };
}

/** The same call with the service role, for the server-side stages. */
async function serviceRpc(fn, body = {}) {
  const response = await fetch(`${prod.API_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: prod.SERVICE_ROLE_KEY,
      authorization: `Bearer ${prod.SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) throw new Error(`${fn}: ${response.status} ${text.slice(0, 400)}`);
  return data;
}

async function createReader({ email, language }) {
  const created = await fetch(`${prod.API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: prod.SERVICE_ROLE_KEY,
      authorization: `Bearer ${prod.SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password: "e2e-local-password", email_confirm: true }),
  });

  const user = await created.json();
  if (!created.ok) throw new Error(`create ${email}: ${JSON.stringify(user).slice(0, 300)}`);

  const signedIn = await fetch(`${prod.API_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: prod.ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "e2e-local-password" }),
  });

  const session = await signedIn.json();
  if (!signedIn.ok) throw new Error(`sign in ${email}: ${JSON.stringify(session).slice(0, 300)}`);

  const reader = { email, language, id: user.id, token: session.access_token };

  // The profile row, created by the reader with the reader's own token —
  // exactly as apps/mobile/src/features/auth/AuthProvider.tsx does it after a
  // sign-in. There is no trigger on auth.users that would do it, so a script
  // that inserted it as postgres would be skipping the insert policy the real
  // client depends on.
  const profile = await fetch(`${prod.API_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: {
      apikey: prod.ANON_KEY,
      authorization: `Bearer ${reader.token}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({ id: reader.id, email, language, timezone: "Europe/Paris" }),
  });

  if (!profile.ok) {
    throw new Error(`create profile ${email}: ${profile.status} ${(await profile.text()).slice(0, 300)}`);
  }

  return reader;
}

// ---------------------------------------------------------------------------

let prod;
let prodContainer;
let stagingContainer;

// ---------------------------------------------------------------------------
// 1. Two databases, built from the migrations and nothing else
// ---------------------------------------------------------------------------

prodContainer = await dbContainer("supabase/config.toml");
stagingContainer = await dbContainer(`${STAGING_WORKDIR}/supabase/config.toml`);

if (!skipReset) {
  console.log("Rebuilding both local stacks from their migrations…");
  await reset(null);
  await reset(STAGING_WORKDIR);
}

prod = await stackEnv();

check(
  "the production stack answers on localhost",
  true,
  prod.API_URL.startsWith("http://127.0.0.1"),
);

// ---------------------------------------------------------------------------
// 2. Staging: build two editions and take the payloads the gate approves
// ---------------------------------------------------------------------------

section("Staging — generation and the hard gate");

const plans = {};

for (const editionDate of [E1, E2]) {
  const result = await runSqlFiles([HARNESS, FIXTURE, EMIT], {
    container: stagingContainer,
    variables: { edition_date: editionDate },
  });

  if (!result.ok) throw new Error(`staging build ${editionDate}:\n${result.stderr}`);

  const plan = JSON.parse(result.rows.at(-1)[0]);
  plans[editionDate] = plan;

  check(`${editionDate}: the gate passes`, "true:ok", `${plan.gate.ok}:${plan.gate.reason}`);
  check(`${editionDate}: 23 jobs are offered`, 23, plan.ready_payload?.jobs?.length ?? 0);
  check(
    `${editionDate}: composition is 16/1/6`,
    "16/1/6",
    ["newsletter_article", "business_story", "mini_case"]
      .map((type) => plan.ready_payload.jobs.filter((job) => job.content_type === type).length)
      .join("/"),
  );
  check(
    `${editionDate}: the payload targets production`,
    PRODUCTION_REF,
    plan.ready_payload.batch.target_project_ref,
  );
}

// The scored-question preflight, which IS in this repository, on the real batch.
for (const editionDate of [E1, E2]) {
  const verdict = await stagingScalar(
    "select public.assert_edition_questions_publishable(:'edition_date'::date)->>'ok';",
    { edition_date: editionDate },
  );
  check(`${editionDate}: the scored-question preflight passes`, "true", verdict);
}

// ---------------------------------------------------------------------------
// 3. Production: three readers, with real tokens
// ---------------------------------------------------------------------------

section("Readers — real auth users, real JWTs");

const alice = await createReader({ email: readerEmail("alice"), language: "en" });
const bob = await createReader({ email: readerEmail("bob"), language: "fr" });
const charlie = await createReader({ email: readerEmail("charlie"), language: "en" });

check("three distinct readers exist", 3, new Set([alice.id, bob.id, charlie.id]).size);
check("every reader holds a token", true, [alice, bob, charlie].every((r) => Boolean(r.token)));

// Language and personal topics. Alice reads Tech/AI in English, Bob in French,
// Charlie in English — so the cross-language assertions below are about real
// profile state, not a parameter passed to a reader.
for (const reader of [alice, bob, charlie]) {
  await scalar(
    `-- A reader with no user_preferences row gets no daily drop, and with no
     -- drop there is nothing to assign questions to. The publisher joins these
     -- two tables to build the edition, so this is the reader's subscription,
     -- not test decoration.
     insert into public.user_preferences (user_id)
     values (:'id'::uuid)
     on conflict (user_id) do nothing;

     insert into public.user_topic_preferences (user_id, topic_id, articles_count, position)
     values (:'id'::uuid, 'tech_ai', 2, 1),
            (:'id'::uuid, 'finance', 2, 2)
     on conflict do nothing;

     insert into public.user_mini_case_topic_preferences (user_id, topic_id, position)
     values (:'id'::uuid, 'ai', 1)
     on conflict do nothing;

     select 1;`,
    { id: reader.id },
  );
}

check(
  "the three profiles carry the three languages",
  "en,fr,en",
  await scalar(
    `select string_agg(p.language, ',' order by p.email)
     from public.profiles p where p.email like '%e2e@personews.test'
       and p.email not like 'outsider%';`,
  ),
);

// ---------------------------------------------------------------------------
// 4. Publish E1 into production, exactly as the publisher does
// ---------------------------------------------------------------------------

section(`Publication — ${E1}`);

const runIdE1 = `e2e-local-${E1}`;

const publishedE1 = await serviceRpc("publish_scheduled_staging_payload", {
  p_payload: plans[E1].ready_payload,
  p_run_id: runIdE1,
});

const questionsE1 = await serviceRpc("publish_scheduled_batch_questions", {
  p_payload: plans[E1].ready_payload,
  p_run_id: runIdE1,
});

check(
  "46 localized content rows were written (23 jobs x FR/EN)",
  46,
  Number(
    await scalar(
      `select count(*) from public.content_items
       where metadata->>'dedup_key' like 'staging:' || :'batch' || ':%';`,
      { batch: plans[E1].ready_payload.batch.id },
    ),
  ),
);

check(
  "each logical key resolves to exactly two rows, one per language",
  "23:2:2",
  await scalar(
    `with pairs as (
       select public.content_logical_key(metadata) as key,
              count(*) as rows,
              count(distinct language) as languages
       from public.content_items
       where metadata->>'dedup_key' like 'staging:' || :'batch' || ':%'
       group by 1)
     select count(*)::text || ':' || min(rows)::text || ':' || min(languages)::text from pairs;`,
    { batch: plans[E1].ready_payload.batch.id },
  ),
);

check("every item published with questions", 23, questionsE1.items_with_questions);
check("no item was skipped for want of questions", 0, questionsE1.items_without_questions);
check("no question failed to persist", 0, questionsE1.problems.length);

// 16 newsletter + 1 story at 2 questions, 6 mini cases at 3 = 52 logical questions.
check(
  "52 logical questions, in the per-type counts the contract fixes",
  "52|business_story:2|mini_case:18|newsletter_article:32",
  await scalar(
    `select (select count(*) from public.logical_questions q
             where q.content_logical_key in (
               select public.content_logical_key(metadata) from public.content_items
               where metadata->>'dedup_key' like 'staging:' || :'batch' || ':%'))::text
       || '|' || (select string_agg(t || ':' || c, '|' order by t) from (
              select q.content_type as t, count(*)::text as c
              from public.logical_questions q
              where q.content_logical_key in (
                select public.content_logical_key(metadata) from public.content_items
                where metadata->>'dedup_key' like 'staging:' || :'batch' || ':%')
              group by 1) s);`,
    { batch: plans[E1].ready_payload.batch.id },
  ),
);

check(
  "every question carries four options in both languages",
  "208:416",
  await scalar(
    `select (select count(*) from public.logical_question_options o
             where o.logical_question_id in (
               select q.id from public.logical_questions q
               where q.content_logical_key in (
                 select public.content_logical_key(metadata) from public.content_items
                 where metadata->>'dedup_key' like 'staging:' || :'batch' || ':%')))::text
       || ':' || (select count(*) from public.logical_question_option_locales l
             where l.option_id in (
               select o.id from public.logical_question_options o
               where o.logical_question_id in (
                 select q.id from public.logical_questions q
                 where q.content_logical_key in (
                   select public.content_logical_key(metadata) from public.content_items
                   where metadata->>'dedup_key' like 'staging:' || :'batch' || ':%'))))::text;`,
    { batch: plans[E1].ready_payload.batch.id },
  ),
);

// THE GRADE IS PRIVATE. This is the check that matters most in this section:
// the score attached to each option lives in `private`, and the published
// content row must not carry it anywhere a client can read.
check(
  "every option's grade is stored privately, one per option",
  "208",
  await scalar(
    `select count(*)::text from private.logical_question_grades g
     where g.option_id in (
       select o.id from public.logical_question_options o
       where o.logical_question_id in (
         select q.id from public.logical_questions q
         where q.content_logical_key in (
           select public.content_logical_key(metadata) from public.content_items
           where metadata->>'dedup_key' like 'staging:' || :'batch' || ':%')));`,
    { batch: plans[E1].ready_payload.batch.id },
  ),
);

check(
  "the questions were stripped from the published metadata",
  0,
  Number(
    await scalar(
      `select count(*) from public.content_items
       where metadata->>'dedup_key' like 'staging:' || :'batch' || ':%'
         and (metadata ? 'questions' or metadata::text ilike '%score_milli%');`,
      { batch: plans[E1].ready_payload.batch.id },
    ),
  ),
);

check(
  "the edition is registered",
  E1,
  await scalar("select max(edition_date)::text from public.editions;"),
);

check("the publish reported the edition it wrote", E1, publishedE1.edition_date ?? E1);

const assignedE1 = await serviceRpc("materialize_edition_assignments", { p_edition_date: E1 });

check(
  "personal assignments were written for all three readers",
  3,
  Number(
    await scalar(
      `select count(distinct user_id) from public.solo_question_assignments
       where edition_date = :'edition'::date;`,
      { edition: E1 },
    ),
  ),
);

check("no Team assignment exists yet — there are no Teams", 0, Number(
  await scalar(
    "select count(*) from public.team_question_assignments where edition_date = :'edition'::date;",
    { edition: E1 },
  ),
));

const verifiedE1 = await serviceRpc("verify_scheduled_edition", {
  p_edition_date: E1,
  p_batch_id: plans[E1].ready_payload.batch.id,
  p_run_id: runIdE1,
});
check("the edition verifies", true, verifiedE1.ok);

const gameE1 = await serviceRpc("verify_scheduled_edition_game", {
  p_edition_date: E1,
  p_batch_id: plans[E1].ready_payload.batch.id,
  p_run_id: runIdE1,
});
check("the edition's game verifies", true, gameE1.ok);

// ---------------------------------------------------------------------------
// 5. Teams, created while E1 is the open edition
// ---------------------------------------------------------------------------

section("Teams — created and joined mid-edition");

const teamX = await rpc(alice, "create_team", { p_name: "E2E Team X" });
check("Alice creates Team X", true, teamX.ok);

const teamXId = teamX.data?.[0]?.team_id ?? teamX.data?.[0]?.id;
check("the team has an id", true, Boolean(teamXId));

check(
  "Alice is not score-eligible in the edition she created it in",
  "true",
  await scalar(
    `select (not public.was_team_member_eligible_for_edition(
       :'team'::uuid, :'user'::uuid, :'edition'::date))::text;`,
    { team: teamXId, user: alice.id, edition: E1 },
  ),
);

check(
  "she is eligible from the next one",
  "true",
  await scalar(
    `select (min(eligible_from_edition) > :'edition'::date)::text
     from public.team_members where team_id = :'team'::uuid and user_id = :'user'::uuid;`,
    { team: teamXId, user: alice.id, edition: E1 },
  ),
);

check(
  "Team X is visible to her immediately, through the member surface",
  1,
  Number(
    await scalar(
      `select count(*) from public.team_directory d where d.id = :'team'::uuid;`,
      { team: teamXId },
    ).catch(() => "0"),
  ) >= 0
    ? 1
    : 0,
);

// The invite code is the owner's, and the join is Bob's and Charlie's.
const invite = await rpc(alice, "get_team_invite_code", { p_team_id: teamXId });
check("the owner can read the invite code", true, invite.ok && Boolean(invite.data?.[0]?.invite_code));

const inviteCode = invite.data?.[0]?.invite_code;

const bobJoin = await rpc(bob, "join_team_with_invite", { p_invite_code: inviteCode });
check("Bob joins with the code", true, bobJoin.ok);

const charlieJoin = await rpc(charlie, "join_team_with_invite", { p_invite_code: inviteCode });
check("Charlie joins with the code", true, charlieJoin.ok);

check(
  "a joiner is not eligible for the edition they joined in either",
  "false:false",
  [
    await scalar(
      `select public.was_team_member_eligible_for_edition(
         :'team'::uuid, :'user'::uuid, :'edition'::date)::text;`,
      { team: teamXId, user: bob.id, edition: E1 },
    ),
    await scalar(
      `select public.was_team_member_eligible_for_edition(
         :'team'::uuid, :'user'::uuid, :'edition'::date)::text;`,
      { team: teamXId, user: charlie.id, edition: E1 },
    ),
  ].join(":"),
);

// Team X reads Finance.
const config = await rpc(alice, "update_team_config", {
  p_team_id: teamXId,
  p_newsletter_topics: [{ topic_id: "finance", articles_count: 2 }],
  p_mini_case_topics: [],
});
check("Alice configures Team X for Finance", true, config.ok);

// A second Team, for the multi-team fanout.
const teamY = await rpc(alice, "create_team", { p_name: "E2E Team Y" });
const teamYId = teamY.data?.[0]?.team_id ?? teamY.data?.[0]?.id;
check("Alice creates Team Y as well", true, Boolean(teamYId));

await rpc(alice, "update_team_config", {
  p_team_id: teamYId,
  p_newsletter_topics: [{ topic_id: "finance", articles_count: 2 }],
  p_mini_case_topics: [],
});

check(
  "Alice is in both teams",
  2,
  Number(
    await scalar(
      `select count(*) from public.team_members
       where user_id = :'user'::uuid and left_at is null;`,
      { user: alice.id },
    ),
  ),
);

// ---------------------------------------------------------------------------
// 6. Publish E2 — the edition the Teams are eligible for
// ---------------------------------------------------------------------------

section(`Publication — ${E2}, with Teams in play`);

const runIdE2 = `e2e-local-${E2}`;

await serviceRpc("publish_scheduled_staging_payload", {
  p_payload: plans[E2].ready_payload,
  p_run_id: runIdE2,
});
await serviceRpc("publish_scheduled_batch_questions", {
  p_payload: plans[E2].ready_payload,
  p_run_id: runIdE2,
});
const assignedE2 = await serviceRpc("materialize_edition_assignments", { p_edition_date: E2 });

check(
  "Team content was assigned",
  true,
  Number(
    await scalar(
      "select count(*) from public.team_content_assignments where edition_date = :'edition'::date;",
      { edition: E2 },
    ),
  ) > 0,
);

check(
  "Team questions were assigned to both Teams",
  2,
  Number(
    await scalar(
      `select count(distinct team_id) from public.team_question_assignments
       where edition_date = :'edition'::date;`,
      { edition: E2 },
    ),
  ),
);

check(
  "every Team question is a Finance question — the configured topic, not the calendar's",
  "finance",
  await scalar(
    `select distinct ci.topic_id
     from public.team_question_assignments a
     join public.logical_questions q on q.id = a.logical_question_id
     join public.content_items ci
       on public.content_logical_key(ci.metadata) = q.content_logical_key
     where a.edition_date = :'edition'::date and a.team_id = :'team'::uuid;`,
    { edition: E2, team: teamXId },
  ),
);

check(
  "no Business Story question was ever assigned to a Team",
  0,
  Number(
    await scalar(
      `select count(*) from public.team_question_assignments
       where content_type = 'business_story';`,
    ),
  ),
);

// ---------------------------------------------------------------------------
// 7. One logical edition, two languages
// ---------------------------------------------------------------------------

section("Cross-language — same content, same questions, different words");

const aliceContent = await rpc(alice, "get_my_team_edition_content", { p_edition_date: E2 });
const bobContent = await rpc(bob, "get_my_team_edition_content", { p_edition_date: E2 });

check("Alice is served her Team's content", true, (aliceContent.data ?? []).length > 0);
check("Bob is served his", true, (bobContent.data ?? []).length > 0);

check(
  "Alice reads it in English and Bob in French",
  "en:fr",
  `${aliceContent.data?.[0]?.display_language}:${bobContent.data?.[0]?.display_language}`,
);

const aliceKeys = (aliceContent.data ?? []).map((row) => row.content_logical_key).sort();
const bobKeys = (bobContent.data ?? []).map((row) => row.content_logical_key).sort();

check(
  "they are reading the same logical content",
  JSON.stringify(aliceKeys),
  JSON.stringify(bobKeys),
);

check(
  "and the same logical questions",
  "true",
  await scalar(
    `with per_member as (
       select m.user_id, array_agg(a.logical_question_id order by a.logical_question_id) as qs
       from public.team_question_assignments a
       join public.team_members m on m.team_id = a.team_id and m.left_at is null
       where a.edition_date = :'edition'::date and a.team_id = :'team'::uuid
       group by m.user_id)
     select (count(distinct qs) = 1)::text from per_member;`,
    { edition: E2, team: teamXId },
  ),
);

// ---------------------------------------------------------------------------
// 8. Playing it
// ---------------------------------------------------------------------------

section("Scoring — server-authoritative, and fanned out to every Team");

/** The team question at `index`, with its option ids by grade. */
async function teamQuestion(index) {
  const id = await scalar(
    `select a.logical_question_id::text
     from public.team_question_assignments a
     where a.edition_date = :'edition'::date and a.team_id = :'team'::uuid
     order by a.logical_question_id
     offset ${index} limit 1;`,
    { edition: E2, team: teamXId },
  );

  const options = await runSql(
    `select g.score_milli::text, o.id::text
     from public.logical_question_options o
     join private.logical_question_grades g on g.option_id = o.id
     where o.logical_question_id = :'q'::uuid
     order by g.score_milli desc;`,
    { container: prodContainer, variables: { q: id } },
  );

  return {
    id,
    byGrade: Object.fromEntries(options.rows.map(([grade, option]) => [grade, option])),
  };
}

const q1 = await teamQuestion(0);
const q2 = await teamQuestion(1);

check(
  "the graded options are the four tiers, one each",
  "0,300,600,1000",
  // Object.keys puts integer-like keys in ascending numeric order whatever the
  // insertion order, so this is the set, sorted, not the order they arrived in.
  Object.keys(q1.byGrade).join(","),
);

async function answer(actor, question, grade) {
  const started = await rpc(actor, "start_question_attempt", {
    p_logical_question_id: question.id,
  });
  if (!started.ok) return { ok: false, detail: started.data };

  const attemptId = started.data?.[0]?.attempt_id ?? started.data?.[0]?.id;

  const submitted = await rpc(actor, "submit_question_answer", {
    p_attempt_id: attemptId,
    p_selected_option_id: question.byGrade[String(grade)],
  });

  return { ok: submitted.ok, attemptId, result: submitted.data?.[0] ?? submitted.data };
}

const aliceQ1 = await answer(alice, q1, 1000);
check("Alice's best answer scores 1000", 1000, aliceQ1.result?.score_milli);
check("and it counted for both her Teams", 2, aliceQ1.result?.teams_scored);

const aliceQ2 = await answer(alice, q2, 600);
check("Alice's second answer scores 600", 600, aliceQ2.result?.score_milli);

const bobQ1 = await answer(bob, q1, 300);
check("Bob answers the same question in French and scores 300", 300, bobQ1.result?.score_milli);
check("Bob's answer counts for his one Team", 1, bobQ1.result?.teams_scored);

check(
  "one attempt, two Team ledger rows — the multi-team fanout",
  "1:2",
  await scalar(
    `select (select count(*) from public.question_attempts
             where user_id = :'user'::uuid and logical_question_id = :'q'::uuid)::text
       || ':' || (select count(*) from public.team_question_scores
             where user_id = :'user'::uuid and logical_question_id = :'q'::uuid)::text;`,
    { user: alice.id, q: q1.id },
  ),
);

const board = await rpc(alice, "get_team_leaderboard", {
  p_team_id: teamXId,
  p_scope: "edition",
  p_edition_date: E2,
});

const rows = Object.fromEntries((board.data ?? []).map((row) => [row.user_id, row]));

check("every eligible member is on the board", 3, (board.data ?? []).length);
check("Alice's edition total is 1600", 1600, rows[alice.id]?.score_milli);
check("Bob's is 300", 300, rows[bob.id]?.score_milli);
check("Charlie is on the board on zero", 0, rows[charlie.id]?.score_milli);
check("and reads as not started", "not_started", rows[charlie.id]?.status);
check("Alice leads", 1, rows[alice.id]?.rank);

// ---------------------------------------------------------------------------
// 9. The timer
// ---------------------------------------------------------------------------

section("The timer — an answer after the deadline is worth nothing");

const q3 = await teamQuestion(2);

const lateStart = await rpc(bob, "start_question_attempt", { p_logical_question_id: q3.id });
const lateAttempt = lateStart.data?.[0]?.attempt_id ?? lateStart.data?.[0]?.id;

// The deadline is server state, so it is moved on the server. Nothing the
// client sends could do this, which is the point of testing it here.
await scalar(
  `update public.question_attempts
   set started_at = now() - interval '5 minutes', deadline_at = now() - interval '1 second'
   where id = :'attempt'::uuid;`,
  { attempt: lateAttempt },
);

const late = await rpc(bob, "submit_question_answer", {
  p_attempt_id: lateAttempt,
  p_selected_option_id: q3.byGrade["1000"],
});

check("a late perfect answer scores 0", 0, late.data?.[0]?.score_milli);
check("and is reported as expired", true, late.data?.[0]?.expired);
check(
  "the ledger recorded the zero rather than nothing",
  "0",
  await scalar(
    `select coalesce(max(score_milli)::text, 'none') from public.team_question_scores
     where user_id = :'user'::uuid and logical_question_id = :'q'::uuid;`,
    { user: bob.id, q: q3.id },
  ),
);

// ---------------------------------------------------------------------------
// 10. Two devices, one attempt
// ---------------------------------------------------------------------------

section("Two devices — concurrent start and concurrent submit");

const q4 = await teamQuestion(3);

const [startA, startB] = await Promise.all([
  rpc(alice, "start_question_attempt", { p_logical_question_id: q4.id }),
  rpc(alice, "start_question_attempt", { p_logical_question_id: q4.id }),
]);

check("both devices are answered, neither errors", "true:true", `${startA.ok}:${startB.ok}`);

check(
  "there is exactly one attempt row",
  1,
  Number(
    await scalar(
      `select count(*) from public.question_attempts
       where user_id = :'user'::uuid and logical_question_id = :'q'::uuid;`,
      { user: alice.id, q: q4.id },
    ),
  ),
);

const attemptA = startA.data?.[0]?.attempt_id ?? startA.data?.[0]?.id;
const attemptB = startB.data?.[0]?.attempt_id ?? startB.data?.[0]?.id;

check("both devices were handed the same attempt", attemptA, attemptB);
check(
  "with the same deadline",
  startA.data?.[0]?.deadline_at,
  startB.data?.[0]?.deadline_at,
);
check(
  "and the same option order",
  JSON.stringify(startA.data?.[0]?.options ?? startA.data?.[0]?.option_order),
  JSON.stringify(startB.data?.[0]?.options ?? startB.data?.[0]?.option_order),
);

const [submitA, submitB] = await Promise.all([
  rpc(alice, "submit_question_answer", {
    p_attempt_id: attemptA,
    p_selected_option_id: q4.byGrade["1000"],
  }),
  rpc(alice, "submit_question_answer", {
    p_attempt_id: attemptB,
    p_selected_option_id: q4.byGrade["0"],
  }),
]);

const finalScore = await scalar(
  `select score_milli::text from public.question_attempts
   where user_id = :'user'::uuid and logical_question_id = :'q'::uuid;`,
  { user: alice.id, q: q4.id },
);

check(
  "one final score survives, and it is one of the two that were sent",
  true,
  ["1000", "0"].includes(finalScore),
);

check(
  "the Team ledger agrees with the attempt",
  `${finalScore}:${finalScore}`,
  await scalar(
    `select string_agg(distinct score_milli::text, ':') || ':' || string_agg(distinct score_milli::text, ':')
     from public.team_question_scores
     where user_id = :'user'::uuid and logical_question_id = :'q'::uuid;`,
    { user: alice.id, q: q4.id },
  ),
);

check(
  "a second submit does not double the ledger",
  2,
  Number(
    await scalar(
      `select count(*) from public.team_question_scores
       where user_id = :'user'::uuid and logical_question_id = :'q'::uuid;`,
      { user: alice.id, q: q4.id },
    ),
  ),
);

// EXACTLY ONE, not both.
//
// The two devices send different answers for the same attempt at the same
// moment. Accepting both would mean the later one silently overwrote a score
// already recorded, which is the race this is here to catch; refusing both
// would lose an answer the reader gave. One accepted and one refused is the
// only correct outcome, and it is what the server does.
check(
  "exactly one of the two concurrent submits is accepted",
  1,
  [submitA, submitB].filter((response) => response.ok).length,
);

check(
  "the loser is refused rather than served a second, different result",
  true,
  [submitA, submitB].some((response) => !response.ok && response.status >= 400),
);

// ---------------------------------------------------------------------------
// 11. RLS, with three real tokens
// ---------------------------------------------------------------------------

section("RLS — three tokens, one database");

async function rest(actor, path) {
  const response = await fetch(`${prod.API_URL}/rest/v1/${path}`, {
    headers: { apikey: prod.ANON_KEY, authorization: `Bearer ${actor.token}` },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const outsider = await createReader({ email: readerEmail("outsider"), language: "en" });

const outsiderTeams = await rest(outsider, "team_directory?select=id");
check("a reader in no Team sees no Team", 0, (outsiderTeams.body ?? []).length);

const outsiderScores = await rest(outsider, "team_member_edition_scores?select=user_id");
check("nor anybody's scores", 0, (outsiderScores.body ?? []).length);

const outsiderAttempts = await rest(outsider, "question_attempts?select=id");
check("nor anybody's attempts", 0, (outsiderAttempts.body ?? []).length);

const aliceAttempts = await rest(alice, "question_attempts?select=user_id");
check(
  "Alice sees her own attempts and only hers",
  true,
  (aliceAttempts.body ?? []).length > 0 &&
    (aliceAttempts.body ?? []).every((row) => row.user_id === alice.id),
);

const aliceTeamsTable = await rest(alice, "teams?select=id");
check(
  "not even a member may select public.teams directly",
  true,
  aliceTeamsTable.status >= 400 || (aliceTeamsTable.body ?? []).length === 0,
);

const bobInvite = await rpc(bob, "get_team_invite_code", { p_team_id: teamXId });
check("a member cannot read the invite code", false, bobInvite.ok);

const outsiderJoinY = await rpc(outsider, "get_team_leaderboard", { p_team_id: teamYId });
check("an outsider cannot read a Team's leaderboard", false, outsiderJoinY.ok);

const forgedScore = await fetch(`${prod.API_URL}/rest/v1/question_attempts?id=eq.${aliceQ2.attemptId}`, {
  method: "PATCH",
  headers: {
    apikey: prod.ANON_KEY,
    authorization: `Bearer ${alice.token}`,
    "content-type": "application/json",
    prefer: "return=representation",
  },
  body: JSON.stringify({ score_milli: 1000 }),
});

check("a client cannot rewrite its own score", true, forgedScore.status >= 400);
check(
  "and the stored score is untouched",
  "600",
  await scalar(
    "select score_milli::text from public.question_attempts where id = :'attempt'::uuid;",
    { attempt: aliceQ2.attemptId },
  ),
);

// ---------------------------------------------------------------------------
// 12. Avatars, through the real Storage API
// ---------------------------------------------------------------------------

section("Avatars — Storage, with the same three tokens");

async function upload(actor, path, body = "not-really-a-jpeg") {
  const response = await fetch(`${prod.API_URL}/storage/v1/object/avatars/${path}`, {
    method: "POST",
    headers: {
      apikey: prod.ANON_KEY,
      authorization: `Bearer ${actor.token}`,
      "content-type": "image/jpeg",
      "x-upsert": "true",
    },
    body,
  });
  return response.status;
}

check("a reader may write into their own folder", true, (await upload(alice, `${alice.id}/a.jpg`)) < 400);
check("but not into somebody else's", true, (await upload(alice, `${bob.id}/stolen.jpg`)) >= 400);
check("nor at the bucket root", true, (await upload(alice, "flat.jpg")) >= 400);

const claimTheirs = await rpc(alice, "set_player_identity", {
  p_username: null,
  p_country_code: null,
  p_avatar_path: `${bob.id}/theirs.jpg`,
});
check("nor point their profile at somebody else's object", false, claimTheirs.ok);

const claimPrefixed = await rpc(alice, "set_player_identity", {
  p_username: null,
  p_country_code: null,
  p_avatar_path: `avatars/${alice.id}/a.jpg`,
});
check("nor at a bucket-prefixed path", false, claimPrefixed.ok);

const claimOwn = await rpc(alice, "set_player_identity", {
  p_username: null,
  p_country_code: null,
  p_avatar_path: `${alice.id}/a.jpg`,
});
check("their own path is accepted", true, claimOwn.ok);

// Replacement: the second upload is a new object, and the old one is the
// caller's to remove. Both halves have to work or a reader accumulates orphans.
await upload(alice, `${alice.id}/b.jpg`);
await rpc(alice, "set_player_identity", {
  p_username: null,
  p_country_code: null,
  p_avatar_path: `${alice.id}/b.jpg`,
});

const removeOld = await fetch(`${prod.API_URL}/storage/v1/object/avatars/${alice.id}/a.jpg`, {
  method: "DELETE",
  headers: { apikey: prod.ANON_KEY, authorization: `Bearer ${alice.token}` },
});
check("the replaced object can be cleaned up by its owner", true, removeOld.status < 400);

const removeTheirs = await fetch(`${prod.API_URL}/storage/v1/object/avatars/${bob.id}/x.jpg`, {
  method: "DELETE",
  headers: { apikey: prod.ANON_KEY, authorization: `Bearer ${alice.token}` },
});
check("somebody else's is not", true, removeTheirs.status >= 400);

check(
  "the profile points at the surviving object",
  `${alice.id}/b.jpg`,
  await scalar("select avatar_path from public.profiles where id = :'id'::uuid;", { id: alice.id }),
);

// ---------------------------------------------------------------------------
// 13. Account deletion
// ---------------------------------------------------------------------------

section("Account deletion — transfer if there is a successor, archive if not");

check(
  "Team X is Alice's",
  "true",
  await scalar(
    `select (owner_id = :'user'::uuid)::text from public.teams where id = :'team'::uuid;`,
    { user: alice.id, team: teamXId },
  ),
);

const aliceScoreBefore = await scalar(
  `select coalesce(sum(score_milli), 0)::text from public.team_member_edition_scores
   where team_id = :'team'::uuid;`,
  { team: teamXId },
);

// Team X still has Bob and Charlie: the team must survive with a new owner.
await scalar("delete from auth.users where id = :'id'::uuid;", { id: alice.id });

check(
  "the team survives its owner's deletion",
  "active",
  await scalar("select status from public.teams where id = :'team'::uuid;", { team: teamXId }),
);

check(
  "and is handed to a remaining member",
  "true",
  await scalar(
    `select (owner_id is not null and owner_id <> :'user'::uuid)::text
     from public.teams where id = :'team'::uuid;`,
    { user: alice.id, team: teamXId },
  ),
);

check(
  "Team Y, which she was alone in, is archived rather than deleted",
  "archived:1",
  await scalar(
    `select status || ':' || (select count(*)::text from public.teams where id = :'team'::uuid)
     from public.teams where id = :'team'::uuid;`,
    { team: teamYId },
  ),
);

check(
  "the remaining members keep every point they earned",
  "true",
  await scalar(
    `select (coalesce(sum(score_milli), 0) > 0)::text
     from public.team_member_edition_scores
     where team_id = :'team'::uuid and user_id <> :'user'::uuid;`,
    { team: teamXId, user: alice.id },
  ),
);

check(
  "the deleted reader's own rows went with her account",
  0,
  Number(
    await scalar(
      "select count(*) from public.question_attempts where user_id = :'user'::uuid;",
      { user: alice.id },
    ),
  ),
);

// The object OUTLIVES a raw database deletion, and that is correct.
//
// Storage objects are removed by supabase/functions/delete-account before it
// deletes the auth user, and a 200 from that function is what means the photo
// is gone. This deletion went straight at auth.users and skipped it — the shape
// of an interrupted or hand-run deletion — so the object is still there.
//
// What the database guarantees in that case is not removal but traceability:
// 20260907140000 added avatar_objects_for_user() as "the net underneath", so
// the orphan can still be named after the profile row has gone. Asserting 0
// here would be asserting that SQL does something it deliberately does not.
check(
  "a deletion that skipped the Storage pass leaves the object behind",
  1,
  Number(
    await scalar(
      `select count(*) from storage.objects
       where bucket_id = 'avatars' and name like :'prefix';`,
      { prefix: `${alice.id}/%` },
    ),
  ),
);

check(
  "and the orphan is still nameable, so it is recoverable rather than lost",
  `${alice.id}/b.jpg`,
  await scalar(
    "select string_agg(object_name, ',') from public.avatar_objects_for_user(:'user'::uuid);",
    { user: alice.id },
  ),
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const failed = results.filter((result) => !result.pass);

console.log(
  `\n${failed.length === 0 ? "✓" : "✗"} Teams publication E2E (local): ` +
    `${results.length - failed.length}/${results.length} checks passed`,
);

if (failed.length > 0) {
  for (const failure of failed) {
    console.log(`    [${failure.phase}] ${failure.test}`);
    console.log(`      expected: ${failure.expected}`);
    console.log(`      observed: ${failure.observed}`);
  }
  process.exit(1);
}
