# delete-account

Deletes the authenticated caller's account and every piece of data owned by it.
Required by both the App Store and Google Play before submission.

## What it deletes

The identity comes from the JWT only. The endpoint deletes the matching
`auth.users` row, and the schema does the rest:

```
auth.users
  └─ public.profiles                       (ON DELETE CASCADE)
       ├─ user_preferences
       ├─ user_topic_preferences
       ├─ user_mini_case_topic_preferences
       ├─ daily_drops ─────────────────────→ daily_drop_items
       ├─ content_interactions
       ├─ mini_case_responses
       ├─ push_tokens ─────────────────────→ push_notification_deliveries
       ├─ push_notification_deliveries
       ├─ user_learning_paths ─────────────→ learning_sessions ──→ learning_session_feedback
       └─ learning_session_feedback
```

Plus one row the cascade cannot reach: the legacy web-newsletter subscriber
(`public.users`, linked from `profiles.legacy_user_id` with `ON DELETE SET
NULL`), which holds a name, an email and a phone number. It is deleted
explicitly, and cascades to `user_topics`.

Never deleted: `content_items`, `sources`, `content_item_sources`, `topics`,
`learning_domains`, `learning_objectives`, `learning_catalog_domains`. That is
shared editorial content, not personal data.

## Security model

- `Authorization: Bearer <jwt>` is mandatory; without it the call is rejected 401.
- The caller is resolved with `auth.getUser()` against the anon key. **Any
  `user_id` in the request body is ignored**, so one account can never delete
  another.
- The service-role key exists only inside this function. It must never be added
  to the Expo app or the Vite web app.
- CORS echoes only origins listed in `ACCOUNT_DELETION_ALLOWED_ORIGINS`.

## Configuration

| Variable | Where | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | auto-injected | provided by the platform |
| `SUPABASE_ANON_KEY` | auto-injected | used to verify the caller's JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injected | used only for the deletion |
| `ACCOUNT_DELETION_ALLOWED_ORIGINS` | **set manually** | comma-separated web origins allowed to call this from a browser, e.g. `https://personewsap.com` |

The mobile app sends no `Origin` header, so it works without this variable; the
public `/delete-account` web page does not.

## Deploy (run by the project owner)

```bash
supabase functions deploy delete-account --project-ref wkbviidrbmehmjbhvpeh
supabase secrets set ACCOUNT_DELETION_ALLOWED_ORIGINS="https://your-web-domain" \
  --project-ref wkbviidrbmehmjbhvpeh
```

Then point the clients at it:

- mobile: **optional since 2026-08-25.** The app derives
  `<EXPO_PUBLIC_SUPABASE_URL>/functions/v1/delete-account` when
  `EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT` is unset, so a build that has a
  Supabase URL can already delete accounts. Set it only to point at a custom
  domain or a proxy:
  `EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT=https://wkbviidrbmehmjbhvpeh.supabase.co/functions/v1/delete-account`
- web: `VITE_ACCOUNT_DELETION_ENDPOINT=` same URL

## Verify after deploying

```bash
# 401 without a token
curl -i -X POST https://wkbviidrbmehmjbhvpeh.supabase.co/functions/v1/delete-account

# 401 with a body-supplied id and no token (the body must never be trusted)
curl -i -X POST https://wkbviidrbmehmjbhvpeh.supabase.co/functions/v1/delete-account \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-0000-0000-000000000000"}'
```

Both must answer `401`. Only then test a real deletion with a throwaway account.
