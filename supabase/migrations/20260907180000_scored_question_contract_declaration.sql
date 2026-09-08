-- The scored-question contract, declared rather than inferred — PRODUCTION.
--
-- THE FALSE GREEN THIS FILE EXISTS FOR.
--
-- `edition_expects_questions` (20260906105000) answered "does this edition owe
-- its readers questions?" like this:
--
--     select exists (select 1 from content_items ci
--                    join logical_questions q on q.content_logical_key = ...)
--
-- It inferred the REQUIREMENT from the PERSISTENCE. So the one failure the
-- verification exists to catch was the one failure it could not see:
--
--   1. staging approves an edition that must carry scored questions;
--   2. stage 1 publishes the editorial content — 46 items, all correct;
--   3. stage 2 throws, or writes nothing at all;
--   4. zero logical_questions rows exist for the batch;
--   5. `edition_expects_questions` finds no questions and concludes none were
--      expected;
--   6. verification returns ok = true, reason `questions_not_expected`;
--   7. staging writes a `published` receipt, the gate stops re-offering the
--      batch, and the edition is live and unplayable — permanently.
--
-- A total failure of the question stage was indistinguishable from a legacy
-- edition, and a total failure is exactly what a broken generator produces.
--
-- THE FIX: THE REQUIREMENT IS A DECLARATION, NOT AN OBSERVATION.
--
-- The canonical staging payload now carries, on its `batch` object:
--
--     scored_questions_required          boolean
--     scored_question_contract_version   integer
--
-- The publisher stamps that declaration onto every item it writes, inside the
-- publishing transaction, as `metadata.staging_scored_question_contract`. From
-- then on the requirement is a recorded fact about the edition, written before
-- a single question existed, and it cannot be un-declared by the question stage
-- failing. An edition marked required stays required when zero questions were
-- written — which is the entire point.
--
-- Nothing below ever reads `logical_questions` to decide whether questions are
-- owed. That table is only ever read to decide whether the owed questions are
-- THERE.
--
-- LEGACY, WITHOUT A SECOND CUTOVER DATE.
--
-- Blocker 2 asks for one clear source and no date restated in ten places. There
-- is no date here at all. The cutover lives in exactly one place — staging's
-- `scored_question_cutover_edition()`, which feeds
-- `batch_requires_scored_questions()`, which produces the declaration. Production
-- reads the declaration and nothing else, and distinguishes three states
-- structurally:
--
--   the metadata key is ABSENT      the item was written by the publisher as it
--                                   was before this migration. Genuinely
--                                   historical, genuinely legacy, and — because
--                                   the patched publisher always stamps the key —
--                                   a state no new publish can ever re-create.
--
--   version = 0                     a contract-aware publisher wrote this item
--                                   and the payload declared nothing. That is a
--                                   staging misconfiguration, not a legacy
--                                   edition, and it FAILS loudly.
--
--   version >= 1                    the declaration is authoritative. `required`
--                                   is what it says.
--
-- So "no declaration" never silently means "no questions expected". It means
-- either a row written months ago, or a bug — and the two are told apart by the
-- presence of a key, not by a calendar.

begin;

-- ---------------------------------------------------------------------------
-- 1. The version this production understands
-- ---------------------------------------------------------------------------
-- One integer, one definition. Staging's `scored_question_contract()` reports
-- the same number as `scored-questions-v<N>`; a payload declaring a version
-- this production has never heard of is refused rather than guessed at.

create or replace function public.scored_question_contract_version()
returns integer
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select 1;
$function$;

comment on function public.scored_question_contract_version() is
  'The scored-question contract version this production project implements. A payload declaring a higher version is refused by publish_scheduled_staging_payload rather than published under rules this database does not know.';

revoke all on function public.scored_question_contract_version() from public, anon, authenticated;
grant execute on function public.scored_question_contract_version() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Reading the declaration off a canonical payload
-- ---------------------------------------------------------------------------
-- Called from inside the publishing transaction, which is why it is allowed to
-- raise: before stage 1 commits, an exception means the database is untouched
-- and the scheduler records a clean refusal. After it commits nothing may throw,
-- and nothing below this line is called after it commits.

create or replace function public.scored_question_declaration(p_batch jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raw_version text := btrim(coalesce(p_batch->>'scored_question_contract_version', ''));
  v_raw_required text := lower(btrim(coalesce(p_batch->>'scored_questions_required', '')));
  v_version integer;
  v_required boolean;
begin
  -- No declaration at all. Recorded as version 0 — "a contract-aware publisher
  -- wrote this and was told nothing" — which the verification treats as a
  -- failure, never as legacy. Deliberately not an exception: refusing to publish
  -- would take the whole edition down over a staging that has not been migrated
  -- yet, whereas this publishes the editorial content, refuses the receipt, and
  -- lets the same batch be offered again once staging declares properly.
  if v_raw_version = '' and v_raw_required = '' then
    return jsonb_build_object('version', 0, 'required', false);
  end if;

  if v_raw_version !~ '^[0-9]{1,4}$' then
    raise exception 'scheduled publish refused: scored_question_contract_version is %, expected an integer',
      coalesce(nullif(v_raw_version, ''), '<absent>');
  end if;

  v_version := v_raw_version::integer;

  if v_version < 1 or v_version > public.scored_question_contract_version() then
    raise exception 'scheduled publish refused: payload declares scored-question contract v%, this project implements v%',
      v_version, public.scored_question_contract_version();
  end if;

  if v_raw_required not in ('true', 'false', 't', 'f') then
    raise exception 'scheduled publish refused: scored_questions_required is %, expected true or false',
      coalesce(nullif(v_raw_required, ''), '<absent>');
  end if;

  v_required := v_raw_required in ('true', 't');

  return jsonb_build_object('version', v_version, 'required', v_required);
end;
$function$;

comment on function public.scored_question_declaration(jsonb) is
  'Parses the scored-question declaration off a canonical payload''s batch object. Version 0 means the payload declared nothing, which the verification fails rather than treating as legacy. An unparseable or future version raises, inside the publish transaction, so nothing commits.';

revoke all on function public.scored_question_declaration(jsonb) from public, anon, authenticated;
grant execute on function public.scored_question_declaration(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The publisher stamps it on every item
-- ---------------------------------------------------------------------------
-- Same technique 20260906100000 used, and for the same reason: the publisher is
-- a 400-line function that lives in 20260826174155 and restating it here would
-- create a second copy to keep in step. It is read, patched at one anchor, and
-- re-executed — and the patch refuses rather than applying blind.
--
-- The stamp goes in `v_metadata`, which is built once per language rendering and
-- written in the same INSERT as the content. There is no window in which an item
-- of a questions-required edition exists without its declaration.

do $$
declare
  v_source text;
  c_anchor constant text := E'\'persisted_by\',\'public.publish_scheduled_staging_payload\'';
begin
  select pg_get_functiondef(p.oid) into v_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'publish_scheduled_staging_payload'
  limit 1;

  if v_source is null then
    raise exception 'publish_scheduled_staging_payload not found: apply 20260826174155 first';
  end if;

  if v_source like '%staging_scored_question_contract%' then
    raise notice 'publisher already stamps the scored-question declaration; nothing to do';
    return;
  end if;

  if position(c_anchor in v_source) = 0 then
    raise exception 'publisher metadata expression did not match; refusing to patch blind';
  end if;

  v_source := replace(
    v_source,
    c_anchor,
    c_anchor || E',\n          \'staging_scored_question_contract\',public.scored_question_declaration(p_payload->\'batch\')'
  );

  if v_source not like '%staging_scored_question_contract%' then
    raise exception 'publisher patch produced no change; refusing to continue';
  end if;

  execute v_source;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. What the edition declared, aggregated over the batch
-- ---------------------------------------------------------------------------
-- Reads content_items and NOTHING else. In particular it does not read
-- logical_questions, and it must never learn to: the whole defect this migration
-- fixes was a requirement inferred from a persistence.

create or replace function public.edition_question_contract(p_batch_id uuid)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with items as (
    select ci.metadata->'staging_scored_question_contract' as declaration
    from public.content_items ci
    where ci.status = 'published'
      and ci.metadata->>'staging_batch_id' = p_batch_id::text
  ),
  counted as (
    select
      count(*)::integer as items,
      -- Written before this migration existed. The only genuinely legacy state.
      count(*) filter (
        where declaration is null or jsonb_typeof(declaration) <> 'object'
      )::integer as historical,
      -- A contract-aware publisher wrote it and staging declared nothing.
      count(*) filter (
        where jsonb_typeof(declaration) = 'object'
          and coalesce((declaration->>'version')::integer, 0) = 0
      )::integer as undeclared,
      count(*) filter (
        where jsonb_typeof(declaration) = 'object'
          and coalesce((declaration->>'version')::integer, 0) >= 1
          and coalesce((declaration->>'required')::boolean, false)
      )::integer as required,
      count(*) filter (
        where jsonb_typeof(declaration) = 'object'
          and coalesce((declaration->>'version')::integer, 0) >= 1
          and not coalesce((declaration->>'required')::boolean, false)
      )::integer as not_required,
      max(coalesce((declaration->>'version')::integer, 0))::integer as version
    from items
  )
  select jsonb_build_object(
    'state', case
      when items = 0 then 'no_items'
      when undeclared > 0 then 'declaration_missing'
      -- One edition cannot be half a game. A batch carrying both a
      -- questions-required item and one that says otherwise was published by
      -- two different things, and neither answer may be trusted.
      when required > 0 and (not_required > 0 or historical > 0) then 'inconsistent'
      when required > 0 then 'required'
      else 'not_required'
    end,
    'contract_version', version,
    'items', items,
    'historical', historical,
    'undeclared', undeclared,
    'declared_required', required,
    'declared_not_required', not_required)
  from counted;
$function$;

comment on function public.edition_question_contract(uuid) is
  'What a published batch DECLARED about scored questions, read from item metadata only. Never consults logical_questions: the requirement is a recorded fact about the edition, not an observation of what the question stage managed to write.';

revoke all on function public.edition_question_contract(uuid) from public, anon, authenticated;
grant execute on function public.edition_question_contract(uuid) to service_role;

-- The boolean kept for its existing callers, now answering from the declaration.
create or replace function public.edition_expects_questions(p_batch_id uuid)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select public.edition_question_contract(p_batch_id)->>'state' = 'required';
$function$;

comment on function public.edition_expects_questions(uuid) is
  'True when this batch DECLARED that it carries scored questions. Answers from metadata.staging_scored_question_contract, never from whether any logical_questions row happens to exist — inferring the requirement from the persistence is the false green this replaced.';

revoke all on function public.edition_expects_questions(uuid) from public, anon, authenticated;
grant execute on function public.edition_expects_questions(uuid) to service_role;

commit;

NOTIFY pgrst, 'reload schema';
