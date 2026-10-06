-- Fixture for set_based_publisher_parity.test.sql. Not a migration.
--
-- Keeps the per-reader publisher (as restated by 20261005130000) under another
-- name, so the parity suite can run it beside the set-based one that
-- 20261005160000 installs next. Runs inside the suite's rolled-back transaction.
alter function public.publish_scheduled_staging_payload(jsonb, text)
  rename to publish_scheduled_staging_payload_v1;
