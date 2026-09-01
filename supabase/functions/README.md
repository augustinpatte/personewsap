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
