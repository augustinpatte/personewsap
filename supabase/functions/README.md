# Edge Functions — which project each one belongs to

Two Supabase projects, one functions folder. **Every function below names its
target project in the first line of its header comment, and refuses at runtime to
serve requests from the wrong one** (it compares `SUPABASE_URL` against the ref it
expects). Deploy by slug, never by folder.

| Function | Project | Ref | Purpose |
| --- | --- | --- | --- |
| `delete-account` | production | `wkbviidrbmehmjbhvpeh` | GDPR account deletion, called by the app |
| `personews-task-publisher` | production | `wkbviidrbmehmjbhvpeh` | The production door: `publish` and `verify` RPCs |
| `personews-task-bridge` | staging | `kukyotcgbnchsoeriqoz` | ChatGPT worker bridge: jobs, outputs, reviews. **Never publishes.** |
| `personews-scheduled-publisher` | staging | `kukyotcgbnchsoeriqoz` | The only publisher. Cron-driven, deterministic. |

```bash
npm run edge:deploy:prod       # delete-account, personews-task-publisher
npm run edge:deploy:staging    # personews-task-bridge, personews-scheduled-publisher
```

Do not run bare `supabase functions deploy` with no slug: it deploys everything in
this folder to the linked project, which is production. The runtime guards turn
that into a loud failure rather than a silent one, but the fix is still a manual
redeploy.

## Secrets

Set in the Supabase dashboard (Project settings → Edge Functions → Secrets) or via
the Management API. Values are never stored in this repository.

**Production (`wkbviidrbmehmjbhvpeh`)**

- `PERSONEWS_PUBLISH_TOKEN_SHA256` — SHA-256 hex of the shared publish token.

**Staging (`kukyotcgbnchsoeriqoz`)**

- `PERSONEWS_PRODUCTION_PUBLISH_TOKEN` — the publish token itself, presented to
  production. Staging never holds a production service-role key.
- `SCHEDULED_PUBLISHER_TOKEN_SHA256` — SHA-256 hex of the token pg_cron presents.
- `TASK_BRIDGE_TOKEN_SHA256` — SHA-256 hex of the ChatGPT bridge token.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform into
each function and always refer to that function's own project.

The cron side of the scheduler reads its token from Vault, not from a secret:

```sql
select name from vault.secrets;  -- personews_scheduled_publisher_token
```

## personews-task-bridge contract

The contract and every decision live in `personews-task-bridge/core.ts`, tested
by `core.test.ts` (`npm run publisher:test`). `index.ts` only wires the database.

**v2 (use this).** `POST` with a JSON body, token in a header:

```http
POST /functions/v1/personews-task-bridge
Authorization: Bearer <bridge token>        # or x-personews-bridge-token: <token>
Content-Type: application/json

{ "action": "jobs", "worker": "a" }
{ "action": "commit", "kind": "outputs", "date": "YYYY-MM-DD", "payload": { ... } }
```

- `date` (or `edition_date`) defaults to the **Europe/Paris** edition date,
  as everywhere else in the pipeline (it was America/Chicago).
- `commit` may carry the whole payload inline; chunks are optional. A POSTed
  chunk may be up to 256 KB of base64url.
- `jobs` **leases** the jobs it hands out (`bridge_claim_generation_jobs`, 45
  minutes). A worker gets only the jobs it now holds; a second overlapping run
  gets its own jobs back, never another worker's. Expired leases are reclaimed.
- An output is recorded **once per (job, claim)** (`bridge_submit_output_once`).
  Each result carries a `status`: `submitted`, `duplicate_identical` (a retry;
  nothing written, the same `output_id` back), `duplicate_conflict` (refused),
  `lease_held_by_other_worker`, `not_submittable`, `job_not_found`.
  Before migration `20261005150000` is applied in staging, the bridge falls back
  to the v1 behaviour (`leasing: "unavailable"`, `submitted_without_ledger`).

**v1 (deprecated, still accepted).** `GET ?token=…&action=…`, chunks in the
URL (≤ 6,500 characters each). Every v1 response carries `Deprecation: true` and
a `deprecations` list. Remove v1 once every Scheduled Task sends the header.

Logs carry the action, the outcome and counts. Never the token, chunk data or
content.
