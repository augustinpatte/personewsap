-- Pin the search_path of the curated launch import helper.
--
-- Recovered from the production database (applied 2026-08-22). The helper calls
-- digest(), which lives in the extensions schema, so 'public' alone was not
-- enough once the function had a fixed search_path.

alter function public.insert_curated_launch_mini_case(jsonb) set search_path = public, extensions;
