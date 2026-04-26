# Supabase Migration Notes

Created migration:

- `supabase/migrations/20260426120000_mobile_app_foundation.sql`

## What It Adds

The migration adds the mobile app foundation schema for PersoNewsAP:

- `profiles`
- `user_preferences`
- `topics`
- `user_topic_preferences`
- `generation_runs`
- `sources`
- `content_items`
- `content_item_sources`
- `daily_drops`
- `daily_drop_items`
- `content_interactions`
- `mini_case_responses`

It keeps the existing newsletter tables intact.

## Profile Model

`profiles.id` directly references `auth.users(id)` and is the primary key. This avoids a separate `auth_user_id` column and keeps RLS policies simple:

- profile ownership: `id = auth.uid()`
- user-owned rows: `user_id = auth.uid()`

The mobile app must create profile rows with `id` set to the authenticated user's id. The profile includes `timezone` with a default of `UTC` for daily-drop scheduling.

## Seed Data

The migration seeds the 8 mobile topic IDs:

- `business`
- `finance`
- `tech_ai`
- `law`
- `medicine`
- `engineering`
- `sport_business`
- `culture_media`

## RLS Assumptions

- Users can insert, read, and update their own `profiles`, `user_preferences`, and `user_topic_preferences`.
- Active `topics` are publicly readable because onboarding needs a stable taxonomy.
- Published `content_items`, their `content_item_sources`, and attached `sources` are readable by authenticated users.
- Users can read their own published `daily_drops` and `daily_drop_items`.
- Users can read and insert their own `content_interactions`.
- Users can read, insert, and update their own `mini_case_responses`.
- `generation_runs` has RLS enabled with no anon/authenticated policies. Generation and admin writes should happen server-side with service role credentials only.

## Important Notes

- The migration intentionally does not add client policies for creating or updating generated content, sources, generation runs, daily drops, or daily drop items.
- `daily_drops` with `status = 'generated'` are hidden from users until published.
- `quick_quiz` is included as a content type for future reinforcement content, but it is not a daily drop slot.
- `content_interactions` intentionally has no broad uniqueness constraint. Multiple feedback messages should be allowed, and repeated interaction events may be useful for analytics. A future partial unique index can be added for specific idempotent event types if needed.
- Service role behavior is not represented in client policies; Supabase service role bypasses RLS and must stay server-side.
