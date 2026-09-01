# Scheduled publication

PersoNews publishes four editions a week — Monday, Wednesday, Friday (daily) and
Sunday (weekly digest) — at **19:00 Europe/Paris**. Since September 2026 that
publication is entirely deterministic and lives inside Supabase. No model, no
agent, no CI runner and no human takes part in the go/no-go decision.

ChatGPT Scheduled Tasks still write the editorial content and still review it.
They fill `generation_outputs` and `generation_reviews` in the staging project and
stop there. Whether that work becomes an edition is decided afterwards, by SQL.

## The path an edition takes

```
pg_cron (staging)                17:00 and 18:00 UTC, every day
  └─ run_scheduled_publication_tick()
       guard: is it 19:00 in Europe/Paris, on a publication day?   ── no ──▶ stop
       └─ net.http_post ──▶ personews-scheduled-publisher   (staging Edge Function)
            └─ get_scheduled_edition_publish_plan(edition_date)     (staging SQL)
                 = assert_edition_publishable()  +  get_ready_batch_payload()
                 └─ gate refuses ──▶ audit row, nothing written, done
            └─ POST personews-task-publisher  (production Edge Function)
                 action=publish ─▶ publish_scheduled_staging_payload()  (one transaction)
            └─ POST personews-task-publisher
                 action=verify  ─▶ verify_scheduled_edition()          (read-only)
                 └─ verification fails ──▶ audit row, NO receipt, done
            └─ mark_batch_published()                                  (staging SQL)
            └─ audit row: published
```

The order is the safety property. Nothing is written to production until the gate
passes; **nothing is written to staging until production has been read back and
found complete**. A receipt is a statement of fact about production, so it is
never issued on the strength of an RPC's own success message.

## The hard gate

`public.assert_edition_publishable(edition_date)` in staging. It returns a verdict
rather than raising, so a refusal is diagnosable data. `ok` is true only when
every one of these holds:

**The batch**

- the day is a publication day (`resolve_staging_edition_kind` — the calendar has
  exactly one definition in this system, and this is it);
- a batch exists for that date with the kind the calendar asked for;
- kind is `daily` or `weekly_digest` — never `test`, never `regular`;
- `target_project_ref = wkbviidrbmehmjbhvpeh`;
- `status = ready`;
- no `publication_receipts` row exists for it (otherwise: no-op, see idempotence).

**The composition**

- exactly 23 jobs;
- 16 newsletter articles, exactly 2 per topic across the eight PersoNews topics;
- 1 business story;
- 6 mini cases, one per product topic, all six present, none repeated;
- no two jobs claiming the same (content_type, topic, mini_case_topic, ordinal).

**Every one of the 23 jobs**

- `status = approved`;
- an output exists for the job's *current* attempt;
- that output has a review;
- `verdict = approved` and `score >= 90`;
- all six critical checks explicitly `true`: `source_grounding`,
  `factual_accuracy`, `safety`, `schema`, `fr_en_parity`,
  `novelty_anti_repetition`;
- `validate_generation_output(job_id, output_json, source_records)` re-run from
  scratch on the stored bytes returns `valid = true`.

If any single condition fails, nothing publishes. 22 of 23 approved is zero
editions. 23 of 23 approved with one preflight failure is zero editions.

`get_scheduled_edition_publish_plan` then calls the canonical
`get_ready_batch_payload` and re-checks that what came back is the same batch, the
same date, the same kind, the same production target, 23 jobs and 16/1/6. The
publisher never assembles a payload by hand.

## 19:00 Europe/Paris, through CET and CEST

pg_cron speaks UTC only. 19:00 Paris is 17:00 UTC in summer and 18:00 UTC in
winter, so the schedule is deliberately dumb and the guard is deliberately smart:

```
cron expression:  0 17,18 * * *          -- both candidate hours, every day
guard:            scheduled_publication_due()
                  = hour(now() at Europe/Paris) = 19
                    and resolve_staging_edition_kind(date at Europe/Paris) is not null
```

Postgres knows the Europe/Paris rules, so exactly one of the two ticks passes the
guard on exactly the four publication days, in both halves of the year, forever,
with no table of DST dates and no clock to change twice a year. The other 13 ticks
a week return `not_due` and write nothing.

The day-of-week filter is in the guard rather than in the cron expression on
purpose: the calendar is defined once, in `resolve_staging_edition_kind`.

## Crossing from staging to production

Two Supabase projects. Staging never holds a production service-role key and
production never holds a staging one.

- staging → production goes over HTTPS to production's own
  `personews-task-publisher` Edge Function, authenticated with a shared token.
  Staging holds the token (`PERSONEWS_PRODUCTION_PUBLISH_TOKEN`); production holds
  only its SHA-256 hash (`PERSONEWS_PUBLISH_TOKEN_SHA256`).
- inside production, `personews-task-publisher` uses that project's own injected
  service-role key and calls nothing but the two canonical RPCs.
- pg_cron → the staging Edge Function is authenticated the same way, with the
  token held in Vault (`personews_scheduled_publisher_token`) and its hash in
  `SCHEDULED_PUBLISHER_TOKEN_SHA256`.

Each function refuses at startup to serve requests from the wrong project, by
comparing its injected `SUPABASE_URL` against the ref it expects.

No service-role key appears in this repository, in any migration, in any log line,
or in any client bundle.

## Idempotence

The run id is derived, not generated:

```
personews-scheduled-publish:scheduled-publisher-v1:<edition_date>:<batch_id>
```

Same edition, same batch, same publisher version, same id — on the first attempt
and on every retry. Three independent things then make a duplicate impossible:

1. the gate refuses any batch that already has a publication receipt, and reports
   it as `already_published` rather than as a failure;
2. `publish_scheduled_staging_payload` keys every item on
   `dedup_key = staging:<batch>:<job>:<lang>` and reuses rather than re-inserts,
   and upserts `daily_drops` on `(user_id, drop_date)`;
3. the cron tick takes an advisory lock and skips if an attempt was made in the
   last 30 minutes.

## When nothing publishes

Nothing is written to production, no batch is marked published, no review is
touched, no approval is invented, no content is edited. The batch stays exactly as
it was, and an audit row records why.

```sql
select edition_date, started_at, reason, gate_passed,
       publication_attempted, publication_succeeded,
       production_verified, receipt_recorded,
       approved_jobs, blockers
from public.scheduled_publication_runs
order by started_at desc
limit 10;
```

Every attempt is kept, including the ones that published nothing — those are the
interesting rows. The same event is mirrored into `automation_health` so existing
health tooling sees it.

## Will tonight's edition go out?

```bash
SUPABASE_ACCESS_TOKEN=sbp_… npm run publisher:status
```

Prints the next edition date and kind, when the cron will fire in both Paris and
UTC time, whether the schedule is armed, how many of the 23 jobs are approved, and
— when the answer is no — exactly which jobs are holding it up. Exit code 0 means
the edition would publish right now.

Or, straight from the Supabase SQL editor on the staging project:

```sql
select public.next_scheduled_publication_status();
```

## Tests

```bash
npm run publisher:test                      # orchestration (vitest, no network)
SUPABASE_ACCESS_TOKEN=sbp_… npm run publisher:test:sql   # the real SQL, rolled back
```

- `supabase/functions/personews-scheduled-publisher/core.test.ts` — what the
  publisher does with a verdict, including the cases SQL cannot reach: production
  refusing, production unreachable, and production accepting but not actually
  holding the edition afterwards.
- `supabase-staging/supabase/tests/scheduled_publication_gate.test.sql` — the real gate,
  real tables, real constraints, real triggers, in one transaction ending in
  ROLLBACK.
- `supabase/tests/scheduled_edition_publication.test.sql` — production's own
  refusals, proving it is a second independent line of defence rather than a
  restatement of the first.

Neither SQL suite creates, modifies or deletes any editorial content, and neither
can publish anything: every scenario is a refusal or a read.

## Manual publication

`npm run content:staging-publish` still exists and still works. It is a
break-glass tool for when the scheduler cannot run, it refuses a batch that
already carries a receipt, and **nothing runs it on a schedule any more** —
two publishers writing the same edition through two different dedup keys is
exactly the duplicate this system must not be able to produce.

## Migrations across two projects

The repository holds two Supabase projects, in two project directories, with two
migration histories that must never mix:

| | directory | project |
| --- | --- | --- |
| production | `supabase/` (CLI default) | `wkbviidrbmehmjbhvpeh` |
| staging | `supabase-staging/supabase/` | `kukyotcgbnchsoeriqoz` |

```bash
# production
supabase migration list --linked
supabase db push --linked --dry-run

# staging
supabase migration list --workdir supabase-staging --linked
supabase db push --workdir supabase-staging --linked --dry-run
```

One shared `migrations/` folder would mean a staging push proposing to replay
every production migration into staging, and a production push proposing the
reverse. With `automation_batches` and `content_items` living in different
projects, either direction is a bad day.

A password-free equivalent, covering both projects at once:

```bash
SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:migration-check
```

It reports `pending` (a local file with no remote row — `db push` would run it)
and `orphaned` (an applied migration with no local file — `db push` refuses to run
at all while one exists). Exit code 0 means nothing already applied would be
replayed.

Two standing conditions, both pre-dating this work:

- **The staging CLI needs `SUPABASE_DB_PASSWORD`.** The staging project will not
  let the CLI create its temporary login role (`cli_login_postgres`), so
  `--linked` falls back to demanding the database password. Everything else works
  once it is exported. `npm run supabase:migration-check` needs no password.
- **Staging has 30 applied migrations with no local file.** They were applied
  directly to the project and cannot be replayed, but they do block
  `supabase db push` for staging until adopted. Adopting them means writing each
  one's recorded `statements` to `supabase-staging/supabase/migrations/`; several
  are deliberately temporary (`temporary_premium_recovery_bridge_20260829` and
  friends), so it is a decision rather than a chore.

Production's own five untracked migrations were adopted this way on 2026-09-01 —
their SQL was read back verbatim from `supabase_migrations.schema_migrations`, no
database was changed, and `supabase db push --linked --dry-run` now reports
"Remote database is up to date."

## What is not automated

Two things remain manual, deliberately or unavoidably.

- **Rotating the shared tokens.** Generate a new token, set
  `PERSONEWS_PUBLISH_TOKEN_SHA256` in production, then
  `PERSONEWS_PRODUCTION_PUBLISH_TOKEN` in staging, in that order. For the cron
  token, update both `SCHEDULED_PUBLISHER_TOKEN_SHA256` (Edge Function secret) and
  the `personews_scheduled_publisher_token` Vault entry.
- **`net.http_post` is executable by `anon`.** pg_net was installed by
  `supabase_admin` with EXECUTE granted to PUBLIC, and only the grantor can revoke
  that — `postgres` cannot. A caller with the staging anon key could therefore
  make the database issue an outbound HTTP request, though not read the reply:
  the `net` schema grants no table privileges to `anon` or `authenticated`, so
  `net.http_request_queue` and `net._http_response`, where the scheduler's token
  transits, stay unreadable. It does not weaken the publisher, which
  authenticates every caller against a token hash regardless of how the request
  arrived. Removing the grant requires Supabase support or an owner-level
  session.

## Word counts

Published newsletter bodies are **220–275 words per language**. That bound is
enforced in three places, all agreeing: the generators, the staging preflight
(`validate_generation_output`), and production's
`enforce_personews_published_quality` trigger. The superseded 120–220 range is
gone and must never return — a trigger at 120–220 would reject every correct
article. `supabase/migrations/20260901093000_scheduled_edition_verification.sql`
writes the current definition into this repository so that replaying migrations
can only ever reassert 220–275.
