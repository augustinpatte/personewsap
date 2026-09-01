-- Recovered from the production database on 2026-09-01.
--
-- This migration was applied to wkbviidrbmehmjbhvpeh directly and never had a
-- file here, so `supabase db push` refused to run at all: it will not touch a
-- database holding migrations it cannot see. The SQL below is the statement
-- recorded verbatim in supabase_migrations.schema_migrations for this version —
-- read back, not reconstructed. No database was changed to create this file.

revoke all on function public.publish_scheduled_staging_payload(jsonb,text) from public, anon, authenticated;
grant execute on function public.publish_scheduled_staging_payload(jsonb,text) to service_role;
