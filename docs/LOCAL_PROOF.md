# Proving the backend locally

Everything in this document runs on this machine, against Docker containers that
`supabase db reset` throws away. Nothing here reaches a hosted Supabase project,
and none of it needs `SUPABASE_ACCESS_TOKEN` — the commands that do talk to a
remote (`teams:test:sql`, `publisher:test:sql`, `supabase:migration-check`) are
listed separately at the bottom and are not part of this loop.

## The one command

```
npm run local:prove
```

Runs, in order: the four production SQL suites, the staging publication gate,
and the two-stack publication E2E. It assumes both stacks are up.

## First time on a machine

```
supabase start                              # production stack, ports 54321-54327
supabase start --workdir supabase-staging   # staging stack,   ports 64320-64327
```

The two stacks run side by side because `supabase-staging/supabase/config.toml`
pins its own ports. Without that they collide on 54321 and — worse — the second
one appears to work while talking to the first.

If `supabase start` hangs on `context deadline exceeded` while pulling images,
Docker Desktop is trying to resolve a system proxy it cannot reach. Settings →
Resources → Proxies → Manual, with every field blank, then restart Docker.

## The commands, one at a time

| Command | What it proves |
| --- | --- |
| `supabase db reset` | Every production migration replays from an empty database. |
| `supabase db reset --workdir supabase-staging` | Same, for staging. |
| `npm run teams:test:sql:local` | The Teams and scored-question contract, against a schema built from the migrations. |
| `npm run db:test:sql:local` | All four production suites: teams, language switch, push claims, scheduled publication. |
| `npm run staging:test:sql:local` | The deterministic hard gate and the scored-question preflight. |
| `npm run teams:test:e2e:local` | A batch generated in staging becomes a published edition in production, assigned to real readers and real Teams, played and scored through real JWTs. |
| `npm run supabase:migration-check` | Without a token: migration filenames — real UTC timestamps, no duplicates. With one: remote drift as well. |

Each SQL suite is one transaction ending in `ROLLBACK`. The E2E is not: it runs
`supabase db reset` on both stacks first and leaves what it built behind, which
is why it only ever runs locally.

## What a green run does not cover

The staging suite prints a caveat on every run, pass or fail, and it means what
it says. Four functions the staging migrations call — `refresh_batch_status`,
`get_ready_batch_payload`, `mark_batch_published` and
`validate_generation_output` — plus the `trg_enforce_production_batch_mode`
trigger exist only inside the live staging project and were never committed.
`supabase-staging/supabase/tests/local_harness.sql` supplies stand-ins written
from their callers so the gate can run at all.

The gate's own logic is genuinely exercised. The editorial rules inside the real
`validate_generation_output` — word counts beyond the one range this repository
records, topic vocabularies, formatting — are not. Read the header of
`local_harness.sql` before treating a pass as coverage of those.

Recovering the real definitions from the staging project and committing them is
the single highest-value thing left to do to this pipeline.

## Commands that DO reach a remote

Not part of `local:prove`, and each one needs a token exported for that command
only:

```
SUPABASE_ACCESS_TOKEN=sbp_… npm run teams:test:sql
SUPABASE_ACCESS_TOKEN=sbp_… npm run publisher:test:sql
SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:migration-check
```

`teams:test:sql -- --with-migrations` inlines every Teams migration into the
suite's transaction and rolls it back, which is how to validate them against a
real remote schema without applying anything. The migration list it uses is
derived from the filenames (`scripts/lib/teams-migrations.mjs`), not hand-kept —
the hand-kept version was missing three.
