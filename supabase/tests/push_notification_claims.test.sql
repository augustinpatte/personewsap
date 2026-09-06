-- Push notification claims and the notification outbox — PRODUCTION project.
--
-- One transaction ending in ROLLBACK: the throwaway readers, devices, editions
-- and delivery rows created below never survive the run, and no real user, real
-- device or real delivery row is read or written. Nothing is sent to Expo: this
-- suite never leaves PostgreSQL.
--
-- It asserts the POST-migration contract and expects
--   20260818100000_push_notification_deliveries
--   20260818123000_push_receipts_and_atomic_claims
--   20260906099000_fix_push_notification_claim_ambiguity
--   20260906099500_notification_outbox
-- to be applied.
--
-- Run it against the migrations WITHOUT applying them:
--   SUPABASE_ACCESS_TOKEN=sbp_… npm run push:test:sql:dry
-- Run it against a project that already has them:
--   SUPABASE_ACCESS_TOKEN=sbp_… npm run push:test:sql
--
-- The final SELECT is the report: `failed` must be 0.
--
-- THE TWELVE CLAIM CASES
--
--   C1  the function can be called at all — the P0. It answered 42702 to every
--       call it ever received, so nothing below could have been reached.
--   C2  a first claim inserts the delivery row and leases it
--   C3  the same claim repeated does not lease it a second time
--   C4  a second worker cannot steal a live lease
--   C5  an expired lease is reclaimable
--   C6  a row already sent is never re-leased — the exactly-once guarantee
--   C7  a terminal failure is never re-leased
--   C8  a retryable failure IS re-leased
--   C9  the same device on two dates is two independent deliveries
--   C10 the same device and date under two kinds is two independent deliveries
--   C11 a malformed row is dropped without costing the rest of the batch
--   C12 an empty batch and a blank claim id are handled, not crashed

begin;

create temp table push_results (
  seq int,
  test text,
  expectation text,
  observed text,
  pass boolean
);

create or replace function pg_temp.record(
  p_seq int, p_test text, p_expected text, p_observed text
) returns void
language sql as $$
  insert into push_results
  values (p_seq, p_test, p_expected, p_observed, p_expected = p_observed);
$$;

create or replace function pg_temp.uid_reader() returns uuid
language sql immutable as $$ select 'a9a90000-0000-4000-8000-00000000009a'::uuid $$;
create or replace function pg_temp.tok_phone() returns uuid
language sql immutable as $$ select 'b9b90000-0000-4000-8000-00000000009b'::uuid $$;
create or replace function pg_temp.tok_tablet() returns uuid
language sql immutable as $$ select 'c9c90000-0000-4000-8000-00000000009c'::uuid $$;

-- Fixture dates far enough in the past that they cannot collide with a real
-- edition, and stable so every assertion can name them.
create or replace function pg_temp.day_one() returns date
language sql immutable as $$ select date '2019-01-07' $$;
create or replace function pg_temp.day_two() returns date
language sql immutable as $$ select date '2019-01-09' $$;

-- The shape the sender sends.
create or replace function pg_temp.rows_for(
  p_tokens uuid[], p_day date, p_kind text default 'edition_ready'
) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'push_token_id', token,
    'user_id', pg_temp.uid_reader(),
    'drop_date', to_char(p_day, 'YYYY-MM-DD'),
    'notification_kind', p_kind)), '[]'::jsonb)
  from unnest(p_tokens) as token;
$$;

create or replace function pg_temp.claim(
  p_rows jsonb, p_claim text, p_ttl integer default 900
) returns integer
language sql as $$
  select count(*)::integer
  from public.claim_push_notification_deliveries(p_rows, p_claim, p_ttl);
$$;

create or replace function pg_temp.status_of(p_token uuid, p_day date, p_kind text default 'edition_ready')
returns text
language sql stable as $$
  select delivery.status
  from public.push_notification_deliveries as delivery
  where delivery.push_token_id = p_token
    and delivery.drop_date = p_day
    and delivery.notification_kind = p_kind;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

do $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000', pg_temp.uid_reader(), 'authenticated', 'authenticated',
    'push-suite-' || pg_temp.uid_reader() || '@example.test', 'x', now(), now(), now(),
    '', '', '', '', '{"provider":"email"}', '{}'
  );

  insert into public.profiles (id, email, language, timezone)
  values (pg_temp.uid_reader(), 'push-suite@example.test', 'fr', 'UTC');

  -- Two devices for one reader: the idempotency key is the device, so both must
  -- be told and retiring one must never suppress the other.
  insert into public.push_tokens (id, user_id, expo_push_token, platform, enabled)
  values
    (pg_temp.tok_phone(), pg_temp.uid_reader(), 'ExponentPushToken[push-suite-phone]', 'ios', true),
    (pg_temp.tok_tablet(), pg_temp.uid_reader(), 'ExponentPushToken[push-suite-tablet]', 'ios', true);
end $$;

-- ---------------------------------------------------------------------------
-- C1 — the function answers at all
-- ---------------------------------------------------------------------------
-- This is the whole P0. Before 20260906099000 every call, including one with no
-- rows, failed with 42702 because `push_token_id` was both a RETURNS TABLE
-- output (and therefore a PL/pgSQL variable) and a column named in the
-- ON CONFLICT inference clause, which is an expression context and so IS
-- variable-substituted.

do $$
declare
  v_error text := 'none';
begin
  begin
    perform pg_temp.claim('[]'::jsonb, 'suite-c1');
  exception when others then
    v_error := sqlstate;
  end;

  perform pg_temp.record(1, 'C1 the claim function can be called', 'none', v_error);

  perform pg_temp.record(2, 'C1 its output column is not a column of the table it writes', 'true',
    (select (count(*) = 0)::text
     from information_schema.columns as output_column
     where output_column.table_schema = 'public'
       and output_column.table_name = 'push_notification_deliveries'
       and output_column.column_name = (
         select p.proargnames[array_length(p.proargnames, 1)]
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'claim_push_notification_deliveries')));

  perform pg_temp.record(3, 'C1 it infers the conflict by constraint name, not by expression', 'true',
    (select (position('on constraint push_notification_deliveries_identity_unique' in lower(p.prosrc)) > 0)::text
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'claim_push_notification_deliveries'));
end $$;

-- ---------------------------------------------------------------------------
-- C2–C5 — the lease
-- ---------------------------------------------------------------------------

do $$
declare
  v_first integer;
  v_second integer;
  v_stolen integer;
  v_reclaimed integer;
begin
  v_first := pg_temp.claim(pg_temp.rows_for(array[pg_temp.tok_phone()], pg_temp.day_one()), 'worker-a');

  perform pg_temp.record(4, 'C2 a first claim leases the device', '1', v_first::text);
  perform pg_temp.record(5, 'C2 it created the delivery row', 'claimed',
    pg_temp.status_of(pg_temp.tok_phone(), pg_temp.day_one()));
  perform pg_temp.record(6, 'C2 the lease carries the worker and an expiry', 'true',
    (select (delivery.claim_id = 'worker-a' and delivery.claim_expires_at > now())::text
     from public.push_notification_deliveries as delivery
     where delivery.push_token_id = pg_temp.tok_phone() and delivery.drop_date = pg_temp.day_one()));

  -- C3: the same worker asking again gets nothing new. A replayed GitHub
  -- Actions run must not produce a second announcement.
  v_second := pg_temp.claim(pg_temp.rows_for(array[pg_temp.tok_phone()], pg_temp.day_one()), 'worker-a');
  perform pg_temp.record(7, 'C3 re-claiming a live lease returns nothing', '0', v_second::text);

  -- C4: and neither does anybody else. This is what makes two senders running
  -- at once — the event-driven one and a fallback schedule — safe.
  v_stolen := pg_temp.claim(pg_temp.rows_for(array[pg_temp.tok_phone()], pg_temp.day_one()), 'worker-b');
  perform pg_temp.record(8, 'C4 a second worker cannot steal a live lease', '0', v_stolen::text);
  perform pg_temp.record(9, 'C4 the original lease is untouched', 'worker-a',
    (select delivery.claim_id from public.push_notification_deliveries as delivery
     where delivery.push_token_id = pg_temp.tok_phone() and delivery.drop_date = pg_temp.day_one()));

  -- C5: a worker that died mid-send must not strand the device forever.
  update public.push_notification_deliveries as delivery
  set claim_expires_at = now() - interval '1 minute'
  where delivery.push_token_id = pg_temp.tok_phone() and delivery.drop_date = pg_temp.day_one();

  v_reclaimed := pg_temp.claim(pg_temp.rows_for(array[pg_temp.tok_phone()], pg_temp.day_one()), 'worker-b');
  perform pg_temp.record(10, 'C5 an expired lease is reclaimable', '1', v_reclaimed::text);
  perform pg_temp.record(11, 'C5 by the worker that reclaimed it', 'worker-b',
    (select delivery.claim_id from public.push_notification_deliveries as delivery
     where delivery.push_token_id = pg_temp.tok_phone() and delivery.drop_date = pg_temp.day_one()));
end $$;

-- ---------------------------------------------------------------------------
-- C6–C8 — terminal states and retries
-- ---------------------------------------------------------------------------

do $$
declare
  v_sent integer;
  v_terminal integer;
  v_retryable integer;
begin
  update public.push_notification_deliveries as delivery
  set status = 'sent', sent_at = now()
  where delivery.push_token_id = pg_temp.tok_phone() and delivery.drop_date = pg_temp.day_one();

  v_sent := pg_temp.claim(pg_temp.rows_for(array[pg_temp.tok_phone()], pg_temp.day_one()), 'worker-c');
  perform pg_temp.record(12, 'C6 a sent delivery is never claimed again', '0', v_sent::text);
  perform pg_temp.record(13, 'C6 and stays sent', 'sent',
    pg_temp.status_of(pg_temp.tok_phone(), pg_temp.day_one()));

  update public.push_notification_deliveries as delivery
  set status = 'terminal_failure', sent_at = null
  where delivery.push_token_id = pg_temp.tok_phone() and delivery.drop_date = pg_temp.day_one();

  v_terminal := pg_temp.claim(pg_temp.rows_for(array[pg_temp.tok_phone()], pg_temp.day_one()), 'worker-c');
  perform pg_temp.record(14, 'C7 a terminal failure is never claimed again', '0', v_terminal::text);

  update public.push_notification_deliveries as delivery
  set status = 'retryable_failure'
  where delivery.push_token_id = pg_temp.tok_phone() and delivery.drop_date = pg_temp.day_one();

  v_retryable := pg_temp.claim(pg_temp.rows_for(array[pg_temp.tok_phone()], pg_temp.day_one()), 'worker-c');
  perform pg_temp.record(15, 'C8 a retryable failure is claimed again', '1', v_retryable::text);
  perform pg_temp.record(16, 'C8 and the previous error is cleared', 'true',
    (select (delivery.error is null)::text from public.push_notification_deliveries as delivery
     where delivery.push_token_id = pg_temp.tok_phone() and delivery.drop_date = pg_temp.day_one()));
end $$;

-- ---------------------------------------------------------------------------
-- C9–C10 — what the identity key separates
-- ---------------------------------------------------------------------------

do $$
declare
  v_other_day integer;
  v_other_kind integer;
begin
  -- C9: the same device on the next edition is a different delivery.
  v_other_day := pg_temp.claim(pg_temp.rows_for(array[pg_temp.tok_phone()], pg_temp.day_two()), 'worker-d');
  perform pg_temp.record(17, 'C9 the same device on another date is a new delivery', '1', v_other_day::text);

  -- C10: and a Teams notification on the same day is a different delivery
  -- again. This is what lets Friends reuse the whole mechanism instead of
  -- growing a second one beside it.
  v_other_kind := pg_temp.claim(
    pg_temp.rows_for(array[pg_temp.tok_phone()], pg_temp.day_two(), 'team_edition_result'), 'worker-d');
  perform pg_temp.record(18, 'C10 another kind on the same day is a new delivery', '1', v_other_kind::text);
  perform pg_temp.record(19, 'C10 both rows exist independently', '2',
    (select count(*)::text from public.push_notification_deliveries as delivery
     where delivery.push_token_id = pg_temp.tok_phone() and delivery.drop_date = pg_temp.day_two()));
  perform pg_temp.record(20, 'C10 the kind check accepts the Teams kinds', 'true',
    (select (position('team_invite_received' in check_definition.definition) > 0
             and position('team_member_joined' in check_definition.definition) > 0
             and position('team_edition_result' in check_definition.definition) > 0)::text
     from (
       select pg_get_constraintdef(c.oid) as definition
       from pg_constraint c
       where c.conname = 'push_notification_deliveries_kind_check'
     ) as check_definition));
end $$;

-- ---------------------------------------------------------------------------
-- C11–C12 — bad input
-- ---------------------------------------------------------------------------

do $$
declare
  v_mixed integer;
  v_empty integer;
  v_blank text := 'none';
begin
  -- C11: one malformed entry must not cost the whole batch its notification.
  -- This is the "one bad token cannot block the others" rule, enforced in the
  -- database rather than trusted to the caller.
  v_mixed := pg_temp.claim(
    jsonb_build_array(
      jsonb_build_object('push_token_id', null, 'user_id', pg_temp.uid_reader(),
                         'drop_date', '2019-01-11', 'notification_kind', 'edition_ready'),
      jsonb_build_object('push_token_id', pg_temp.tok_tablet(), 'user_id', pg_temp.uid_reader(),
                         'drop_date', '2019-01-11', 'notification_kind', 'edition_ready')),
    'worker-e');

  perform pg_temp.record(21, 'C11 a malformed row is dropped, the good one is claimed', '1', v_mixed::text);
  perform pg_temp.record(22, 'C11 exactly one row was written', '1',
    (select count(*)::text from public.push_notification_deliveries as delivery
     where delivery.drop_date = date '2019-01-11'));

  -- C12: an empty batch is a normal outcome, not an error — the sender calls
  -- this whenever every device is already up to date.
  v_empty := pg_temp.claim('[]'::jsonb, 'worker-f');
  perform pg_temp.record(23, 'C12 an empty batch claims nothing and does not fail', '0', v_empty::text);

  begin
    perform pg_temp.claim(pg_temp.rows_for(array[pg_temp.tok_tablet()], pg_temp.day_one()), '   ');
  exception when others then
    v_blank := sqlstate;
  end;

  perform pg_temp.record(24, 'C12 a blank claim id is refused', '22023', v_blank);
end $$;

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------
-- Publishing an edition has to write the event in the same transaction, and the
-- event must be one per edition however many readers' drops that transaction
-- writes.

do $$
declare
  v_events integer;
  v_claimed integer;
begin
  insert into public.daily_drops (user_id, drop_date, language, status, generated_at, published_at)
  values (pg_temp.uid_reader(), pg_temp.day_one(), 'fr', 'published', now(), now());

  perform pg_temp.record(25, 'O1 publishing a drop enqueues an edition event', '1',
    (select count(*)::text from public.notification_outbox as outbox
     where outbox.event_type = 'edition_published' and outbox.event_date = pg_temp.day_one()));

  -- A second reader's drop for the same edition is the same event.
  update public.daily_drops as drops
  set status = 'published', updated_at = now()
  where drops.user_id = pg_temp.uid_reader() and drops.drop_date = pg_temp.day_one();

  perform pg_temp.record(26, 'O2 a second write for the same edition is still one event', '1',
    (select count(*)::text from public.notification_outbox as outbox
     where outbox.event_type = 'edition_published' and outbox.event_date = pg_temp.day_one()));

  select count(*)::integer into v_claimed
  from public.claim_notification_events('worker-outbox', 10, 900);

  perform pg_temp.record(27, 'O3 the event can be claimed', 'true', (v_claimed >= 1)::text);
  perform pg_temp.record(28, 'O3 claiming it a second time returns nothing', '0',
    (select count(*)::text from public.claim_notification_events('worker-outbox-2', 10, 900)));

  perform public.complete_notification_event(
    (select outbox.id from public.notification_outbox as outbox
     where outbox.event_date = pg_temp.day_one()), true, null);

  perform pg_temp.record(29, 'O4 completing it marks it processed', 'processed',
    (select outbox.status from public.notification_outbox as outbox
     where outbox.event_date = pg_temp.day_one()));

  -- A draft drop is not an edition and must never be announced.
  insert into public.daily_drops (user_id, drop_date, language, status, generated_at)
  values (pg_temp.uid_reader(), pg_temp.day_two(), 'fr', 'draft', now());

  select count(*)::integer into v_events
  from public.notification_outbox as outbox
  where outbox.event_date = pg_temp.day_two();

  perform pg_temp.record(30, 'O5 an unpublished drop enqueues nothing', '0', v_events::text);
end $$;

-- ---------------------------------------------------------------------------
-- Nothing here is reachable from a client key
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.record(31, 'S1 the outbox has RLS on and no policy', 'true',
    (select (c.relrowsecurity and not exists (
       select 1 from pg_policies p
       where p.schemaname = 'public' and p.tablename = 'notification_outbox'))::text
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'notification_outbox'));

  perform pg_temp.record(32, 'S2 anon and authenticated cannot execute the claim functions', 'false',
    (select bool_or(
       has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'))::text
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('claim_push_notification_deliveries', 'claim_notification_events',
                         'complete_notification_event', 'get_edition_notification_health')));

  perform pg_temp.record(33, 'S3 the service role can', 'true',
    (select bool_and(has_function_privilege('service_role', p.oid, 'execute'))::text
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('claim_push_notification_deliveries', 'claim_notification_events',
                         'complete_notification_event', 'get_edition_notification_health')));

  perform pg_temp.record(34, 'S4 every new function pins its search_path', 'true',
    (select bool_and(array_to_string(p.proconfig, ',') like '%search_path%')::text
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('claim_push_notification_deliveries', 'claim_notification_events',
                         'complete_notification_event', 'get_edition_notification_health',
                         'enqueue_published_edition_notification_events')));
end $$;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from push_results) as checks,
  (select count(*) from push_results where pass) as passed,
  (select count(*) from push_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from push_results where not pass) as failures;

rollback;
