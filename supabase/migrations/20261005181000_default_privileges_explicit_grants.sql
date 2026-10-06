-- Default privileges: new objects start closed — PRODUCTION.
--
-- WHAT WAS OPEN
--
-- Supabase's defaults for objects the postgres role creates in public grant
-- anon and authenticated ALL on every new table and sequence and EXECUTE on
-- every new function — and Postgres grants EXECUTE on every new function to
-- PUBLIC on top. A future migration that forgets a REVOKE ships a table that is
-- writable through the Data API wherever RLS is off, or a SECURITY DEFINER
-- function anyone can call. Every recent migration already revokes and grants
-- explicitly; this makes the explicit way the only way.
--
-- WHAT CHANGES
--
-- For objects the postgres role creates FROM NOW ON:
--   tables, sequences  in public: no grant to anon or authenticated
--   functions          in public: no EXECUTE for anon or authenticated
--   functions          anywhere : no EXECUTE for PUBLIC (a per-schema rule
--                                 cannot take back a global default, so this
--                                 one is global, for the postgres role only)
-- service_role keeps its defaults. Nothing that exists today changes: every
-- current grant stays exactly as it is, explicit.
--
-- CONSEQUENCE FOR FUTURE MIGRATIONS
--
-- A new table the app reads, or a new RPC or RLS helper the app calls, needs
-- its GRANT written out (as the recent migrations already do). Forgetting it now
-- fails closed — "permission denied" in development — instead of open in
-- production. Proved by supabase/tests/default_privileges.test.sql.
--
-- Forward-only.

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
