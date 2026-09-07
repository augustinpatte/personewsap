# Deploying the notification hotfix

Three migrations repair a P0: `claim_push_notification_deliveries` has answered
`42702 column reference "push_token_id" is ambiguous` to every call it has ever
received, so no edition notification this product has published was ever
attempted.

They must reach production **without** carrying the unrelated Teams migrations
that are also unapplied, and without a window in which the database and the
deployed sender disagree.

Everything below was checked against the installed CLI and the real remote
history on 2026-09-06. Nothing in it was applied.

## The tooling, as installed

```
$ supabase --version
2.95.4
```

`supabase db push` accepts `--dry-run`, `--include-all`, `--include-roles`,
`--include-seed`, `--linked`, `--local`, `--db-url`, `--password`. **There is no
`--include <file>` flag.** Any runbook that names one is describing a CLI that
does not exist. What `db push` pushes is every local migration absent from the
remote `supabase_migrations.schema_migrations`, so from the repository root it
would push every pending migration at once. As recorded on 2026-09-06 that was
twelve:

```
$ supabase db push --dry-run --linked
Would push these migrations:
 • 20260906080000_fix_push_notification_claim_ambiguity.sql
 • 20260906081000_notification_outbox.sql
 • 20260906082000_notification_dispatch_cron.sql
 • 20260906090000_edition_registry.sql
 • 20260906091000_player_identity.sql
 • 20260906092000_teams_foundation.sql
 • 20260906093000_scored_questions.sql
 • 20260906094000_question_attempts_and_scoring.sql
 • 20260906095000_realtime_and_moderation.sql
 • 20260906100000_publish_scored_questions.sql
 • 20260906101000_avatar_storage.sql
 • 20260906102000_team_ownership_and_deletion.sql
```

Two more Teams migrations have been added since that transcript was taken —
`20260906103000_team_content_assignments.sql` and
`20260906104000_edition_assignment_engine.sql` — so the list is now fourteen.
The transcript above is left as it was observed; re-run the dry run before
acting on it. Nothing about the hotfix procedure changes: the three hotfix
migrations still sort first, and every Teams migration is still newer.

## Reading migration history

`SUPABASE_ACCESS_TOKEN` must be exported. Nothing here writes.

```sh
# Production — local vs remote vs pending, from the CLI itself.
supabase migration list --linked

# The same four numbers for both projects, without a link, straight from the
# history table:
npm run supabase:migration-check
```

Production, at the time of writing: **41 remote, 53 local, 12 pending, 0
orphaned.** All twelve pending are the 2026-09-06 batch.

Staging is a **different lineage** and this repository is not its source of
truth: 33 remote versions, none of which appear in `supabase/migrations`, and
`supabase-staging/supabase/migrations` tracks only the last three. Never run
`supabase db push` against staging from the repository root — it would report 53
pending and 33 orphaned, which is the correct answer to the wrong question.

## Why the isolation is a directory and not a flag

A project directory holding only the three hotfix migrations does **not** work,
and it is worth recording how it fails:

```
$ supabase db push --dry-run --linked --workdir <only-the-three>
Remote migration versions not found in local migrations directory.
… try repairing the migration history table:
supabase migration repair --status reverted 20260202160716 …41 versions…
```

`db push` refuses to run against a history containing versions it cannot see
locally, and offers to mark all forty-one applied migrations as reverted. That
would be telling Supabase that work it did is work it did not do. It is not on
the table, and neither is any other form of hand-editing the history table.

The directory that does work is **the whole history minus the Teams batch**:

```sh
node scripts/notification-hotfix-workdir.mjs
```

44 migrations — the 41 already applied, so the CLI sees a complete history, plus
the 3 that are the hotfix. Pending is therefore exactly the hotfix. Verified:

```
$ supabase db push --dry-run --linked --workdir .supabase-hotfix/notification
Would push these migrations:
 • 20260906080000_fix_push_notification_claim_ambiguity.sql
 • 20260906081000_notification_outbox.sql
 • 20260906082000_notification_dispatch_cron.sql
```

Nothing is faked: each of the three is genuinely executed and genuinely recorded
under the version string the repository uses, so a later push from the repository
root sees them as applied and skips them.

### And why the hotfix sorts first

`20260906080000`–`082000` sort **before** the Teams batch at `090000`–`104000`.
After the hotfix, the newest applied version is `20260906082000`, every Teams
migration is still newer, and deploying Teams later is a plain forward push. Had
the hotfix sorted last, Teams would afterwards be *out of order* and would need
`--include-all` — the one flag whose whole job is to sweep up everything the
remote has not seen. The ordering is what makes that flag unnecessary.

The three can sort first because they depend on nothing in Teams: they touch
`push_notification_deliveries`, `daily_drops` and `notification_outbox`, all of
which exist independently of it, and no Teams migration reads a push table.

## There is no compatibility window

The claim RPC keeps its name, its argument names and types, and its response
shape — `RETURNS TABLE(push_token_id UUID)`, replaced with `CREATE OR REPLACE`,
so the function is never absent for an instant.

|                    | RPC old (42702 on every call) | RPC new |
| ------------------ | ----------------------------- | ------- |
| sender on `main`   | broken already                | **works** |
| sender on this branch | broken already             | **works** |

Both senders send `p_rows` / `p_claim_id` / `p_claim_ttl_seconds` and read
`row.push_token_id`. Neither `DB_NEW + MAIN_OLD` nor `DB_OLD + MAIN_NEW` is a
regression on any timescale, so thirty or sixty seconds between the migration and
the merge costs nothing. Pinned by
`supabase/tests/pushNotificationContract.test.ts` and by C1 in
`supabase/tests/push_notification_claims.test.sql`.

## The gate

The suite runs the three migrations and 50 assertions inside one transaction that
ends in `ROLLBACK`, against real production PostgreSQL. Nothing is mutated and
nothing reaches Expo.

```sh
SUPABASE_ACCESS_TOKEN=… npm run push:test:sql:dry -- --production
```

This must print `50/50 checks passed` **before** anything is deployed. If it
cannot be run, the answer is READY=NO.

## Order

1. `SUPABASE_ACCESS_TOKEN=… npm run push:test:sql:dry -- --production` → 50/50.
2. `node scripts/notification-hotfix-workdir.mjs`
3. `supabase link --project-ref wkbviidrbmehmjbhvpeh --workdir .supabase-hotfix/notification`
4. `supabase db push --dry-run --linked --workdir .supabase-hotfix/notification`
   — must list the three files and nothing else. A Teams migration here means stop.
5. `supabase db push --linked --workdir .supabase-hotfix/notification`
6. `supabase migration list --linked` → the three appear as applied; Teams still pending.
7. `SUPABASE_ACCESS_TOKEN=… npm run push:test:sql -- --production` → 50/50 against
   the applied schema this time.
8. Merge the branch. Order against steps 5–7 does not matter; see the table above.
9. Deploy the edge function that carries the verification boundary:
   `supabase functions deploy personews-task-publisher --project-ref wkbviidrbmehmjbhvpeh --no-verify-jwt`
   Until this is deployed, events sit at `awaiting_verification` and the recovery
   schedules send the notifications — late, never wrongly.
10. Vault secrets in the production project, when the event path is wanted:
    `personews_notification_dispatch_url`, `personews_notification_dispatch_token`.
    Until they exist `dispatch_notification_events` reports `not_configured` and
    the recovery schedules are the delivery path.
11. `npm run content:notification-health -- --date <edition>` after the next
    edition. `never_attempted` must be 0.

Teams is a separate, separately approved deployment. From the repository root,
after the hotfix, it is `supabase db push --dry-run --linked` then
`supabase db push --linked` — no `--include-all`, ever.

## Rollback

The claim function: re-apply the body from `20260818123000` and it is broken
again, which is a worse state than the one being rolled back from. There is no
sensible rollback of this migration; there is only forward.

The outbox and the dispatcher are additive. To stop the event path without
touching the edition path: `select cron.unschedule('personews-notification-dispatch');`
The recovery schedules keep sending.
