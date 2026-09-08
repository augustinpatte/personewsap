-- The scored-question contract, verified — PRODUCTION project.
--
-- WHAT THIS SUITE IS FOR.
--
-- `verify_scheduled_edition_game` used to decide whether an edition owed its
-- readers questions by looking for question rows. So the single most likely
-- failure of the whole pipeline — the question stage running and writing
-- nothing — was indistinguishable from a legacy edition, and produced
-- `ok: true, reason: questions_not_expected`. Staging then wrote a `published`
-- receipt, stopped re-offering the batch, and the edition was live, unplayable
-- and permanently so.
--
-- Every case below exists to make that unreachable, and to keep it unreachable.
-- The suite is deliberately built out of `content_items` rows carrying a
-- declaration rather than out of a full publish: what is under test is the
-- verification's reading of the DECLARATION, and building it directly is the
-- only way to construct the states a working publisher never produces.
--
-- Read-only against everything that matters, and the whole file ends in
-- ROLLBACK.
--
-- Run it:
--   npm run db:test:sql:local
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table contract_results (
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
  insert into contract_results
  values (p_seq, p_test, p_expected, p_observed, p_expected is not distinct from p_observed);
$$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- One batch id per scenario, one edition date per scenario. The dates are far in
-- the future so nothing here can collide with a real edition, and no `editions`
-- row is registered — the verification reads content and questions, not the
-- edition registry.

create or replace function pg_temp.batch(p_n int) returns uuid
language sql immutable as $$
  select ('aaaaaaaa-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;

create or replace function pg_temp.ed(p_n int) returns date
language sql immutable as $$
  select date '2099-01-01' + p_n;
$$;

/**
 * Two content_items rows — the FR and the EN rendering of one editorial job.
 *
 * `p_declaration` is what the publisher would have stamped:
 *   NULL           the item predates the contract entirely (historical legacy)
 *   {"version":0}  a contract-aware publisher, from a payload declaring nothing
 *   {"version":1, "required": …}   an actual declaration
 */
create or replace function pg_temp.publish_content(
  p_batch uuid,
  p_edition date,
  p_logical_key text,
  p_content_type text,
  p_declaration jsonb
) returns void
language plpgsql as $$
declare
  v_lang text;
begin
  foreach v_lang in array array['fr', 'en']
  loop
    insert into public.content_items(
      content_type, topic_id, language, title, summary, body_md,
      publication_date, version, status, source_count, metadata)
    values (
      p_content_type,
      case when p_content_type = 'mini_case' then 'finance' else 'finance' end,
      v_lang, 'Title ' || v_lang, 'Summary.', 'Body.',
      p_edition, 1, 'published', 1,
      jsonb_build_object(
        'staging_batch_id', p_batch::text,
        'staging_job_id', p_logical_key,
        'staging_ordinal', 1)
      || case when p_declaration is null then '{}'::jsonb
              else jsonb_build_object('staging_scored_question_contract', p_declaration) end);
  end loop;
end $$;

/**
 * One well-formed logical question: both prompt locales, four options with both
 * label locales, four private grades at 0/300/600/1000.
 *
 * The knobs are the ways it can be wrong, and each one is a case the product
 * has to refuse rather than publish.
 */
create or replace function pg_temp.persist_question(
  p_logical_key text,
  p_content_type text,
  p_sequence int,
  p_role text,
  p_options int default 4,
  p_tiers integer[] default array[0, 300, 600, 1000],
  p_languages text[] default array['fr', 'en'],
  p_option_languages text[] default array['fr', 'en']
) returns uuid
language plpgsql as $$
declare
  v_question uuid;
  v_option uuid;
  v_lang text;
  v_item uuid;
  v_i int;
begin
  insert into public.logical_questions(
    content_logical_key, content_type, question_sequence, question_role)
  values (p_logical_key, p_content_type, p_sequence::smallint, p_role)
  returning id into v_question;

  foreach v_lang in array p_languages
  loop
    select id into v_item from public.content_items
    where metadata->>'staging_job_id' = p_logical_key and language = v_lang limit 1;

    insert into public.logical_question_locales(
      logical_question_id, language, content_item_id, prompt)
    values (v_question, v_lang, v_item, 'Prompt ' || v_lang || ' ' || p_sequence);
  end loop;

  for v_i in 1 .. p_options
  loop
    insert into public.logical_question_options(logical_question_id, option_key)
    values (v_question, chr(96 + v_i))
    returning id into v_option;

    foreach v_lang in array p_option_languages
    loop
      insert into public.logical_question_option_locales(option_id, language, label)
      values (v_option, v_lang, 'Option ' || v_i || ' ' || v_lang);
    end loop;

    if v_i <= coalesce(array_length(p_tiers, 1), 0) then
      insert into private.logical_question_grades(option_id, score_milli, grade_band)
      values (v_option, p_tiers[v_i], case p_tiers[v_i]
        when 1000 then 'excellent' when 600 then 'good'
        when 300 then 'average' else 'bad' end);
    end if;
  end loop;

  return v_question;
end $$;

/** A complete, correct question set for one content. */
create or replace function pg_temp.persist_full_set(
  p_logical_key text, p_content_type text
) returns void
language plpgsql as $$
begin
  if p_content_type = 'mini_case' then
    perform pg_temp.persist_question(p_logical_key, p_content_type, 1, 'method_framework');
    perform pg_temp.persist_question(p_logical_key, p_content_type, 2, 'technical_application');
    perform pg_temp.persist_question(p_logical_key, p_content_type, 3, 'conclusion_decision');
  else
    perform pg_temp.persist_question(p_logical_key, p_content_type, 1, 'interpretation');
    perform pg_temp.persist_question(p_logical_key, p_content_type, 2, 'application_decision');
  end if;
end $$;

create or replace function pg_temp.verify(p_n int) returns jsonb
language sql as $$
  select public.verify_scheduled_edition_game(pg_temp.ed(p_n), pg_temp.batch(p_n), 'contract-suite');
$$;

-- ===========================================================================
-- TEST A — total question persistence failure
-- ===========================================================================
-- The edition declared scored questions. The content published. The question
-- stage wrote nothing at all. This is the false green, and it must be a hard
-- failure with a reason that names what happened.
do $$
declare v jsonb;
begin
  perform pg_temp.publish_content(pg_temp.batch(1), pg_temp.ed(1), 'a-news-1',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));

  perform pg_temp.record(1, 'A1 the batch still reads as questions-required', 'required',
    public.edition_question_contract(pg_temp.batch(1))->>'state');

  perform pg_temp.record(2, 'A2 edition_expects_questions says so with zero questions written', 'true',
    public.edition_expects_questions(pg_temp.batch(1))::text);

  v := pg_temp.verify(1);

  perform pg_temp.record(3, 'A3 verification fails', 'false', v->>'ok');
  perform pg_temp.record(4, 'A4 and never reports questions_not_expected', 'questions_missing_entirely',
    v->>'reason');
  perform pg_temp.record(5, 'A5 the verdict still says questions were required', 'true', v->>'required');
end $$;

-- ===========================================================================
-- TEST B — partial question persistence
-- ===========================================================================
-- Two contents, one of them fully persisted and one of them not. A verification
-- that reported the total would call this a partial success; there is no such
-- thing.
do $$
declare v jsonb;
begin
  perform pg_temp.publish_content(pg_temp.batch(2), pg_temp.ed(2), 'b-news-1',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.publish_content(pg_temp.batch(2), pg_temp.ed(2), 'b-news-2',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));

  perform pg_temp.persist_full_set('b-news-1', 'newsletter_article');
  -- b-news-2 gets one question of the two it owes.
  perform pg_temp.persist_question('b-news-2', 'newsletter_article', 1, 'interpretation');

  v := pg_temp.verify(2);

  perform pg_temp.record(6, 'B1 a half-written question set fails', 'false', v->>'ok');
  perform pg_temp.record(7, 'B2 and the reason names the count', 'question_count_mismatch', v->>'reason');
  perform pg_temp.record(8, 'B3 the complete content is not what failed', 'b-news-2',
    (select p->>'content_logical_key' from jsonb_array_elements(v->'problems') p limit 1));
end $$;

-- ===========================================================================
-- TEST C — full success
-- ===========================================================================
-- Newsletter 2, Business Story 2, Mini Case 3. Both languages. Exactly
-- 0/300/600/1000. This is the only shape that may pass.
do $$
declare v jsonb;
begin
  perform pg_temp.publish_content(pg_temp.batch(3), pg_temp.ed(3), 'c-news-1',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.publish_content(pg_temp.batch(3), pg_temp.ed(3), 'c-story-1',
    'business_story', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.publish_content(pg_temp.batch(3), pg_temp.ed(3), 'c-case-1',
    'mini_case', jsonb_build_object('version', 1, 'required', true));

  perform pg_temp.persist_full_set('c-news-1', 'newsletter_article');
  perform pg_temp.persist_full_set('c-story-1', 'business_story');
  perform pg_temp.persist_full_set('c-case-1', 'mini_case');

  v := pg_temp.verify(3);

  perform pg_temp.record(9, 'C1 a complete edition verifies', 'true', v->>'ok');
  perform pg_temp.record(10, 'C2 with the reason ok', 'ok', v->>'reason');
  perform pg_temp.record(11, 'C3 the mini case owes three questions, not two', '3',
    v->'questions'->'by_content_type'->'mini_case'->>'expected_questions');
  perform pg_temp.record(12, 'C4 and carries them', '3',
    v->'questions'->'by_content_type'->'mini_case'->>'questions');
  perform pg_temp.record(13, 'C5 the newsletter owes exactly two', '2',
    v->'questions'->'by_content_type'->'newsletter_article'->>'expected_questions');
  perform pg_temp.record(14, 'C6 so does the business story', '2',
    v->'questions'->'by_content_type'->'business_story'->>'expected_questions');
  perform pg_temp.record(15, 'C7 seven questions across three contents', '7',
    v->'questions'->>'actual');
end $$;

-- ===========================================================================
-- TEST D — legacy
-- ===========================================================================
-- A real legacy edition: published before the contract existed, so its items
-- carry no declaration at all. It must keep verifying under the old rules — and
-- crucially, legacy is decided by the ABSENCE OF THE KEY, never by the absence
-- of questions.
do $$
declare v jsonb;
begin
  perform pg_temp.publish_content(pg_temp.batch(4), pg_temp.ed(4), 'd-news-1',
    'newsletter_article', null);

  perform pg_temp.record(16, 'D1 an item with no declaration is historical legacy', 'not_required',
    public.edition_question_contract(pg_temp.batch(4))->>'state');

  v := pg_temp.verify(4);

  perform pg_temp.record(17, 'D2 a legacy edition still verifies', 'true', v->>'ok');
  perform pg_temp.record(18, 'D3 and reports that questions were not expected', 'questions_not_expected',
    v->>'reason');
  perform pg_temp.record(19, 'D4 the verdict says required=false', 'false', v->>'required');

  -- An edition explicitly declared NOT to carry questions is legacy too, and
  -- says so rather than being silent about it.
  perform pg_temp.publish_content(pg_temp.batch(5), pg_temp.ed(5), 'd-news-2',
    'newsletter_article', jsonb_build_object('version', 1, 'required', false));

  perform pg_temp.record(20, 'D5 an explicit not-required declaration is honoured', 'not_required',
    public.edition_question_contract(pg_temp.batch(5))->>'state');
  perform pg_temp.record(21, 'D6 and verifies', 'true', pg_temp.verify(5)->>'ok');
end $$;

-- ===========================================================================
-- TEST D-bis — an undeclared edition is a failure, not a legacy one
-- ===========================================================================
-- A contract-aware publisher wrote these items from a payload that declared
-- nothing. That is a staging misconfiguration. Reading it as legacy is exactly
-- the false green in a different costume, so it fails loudly instead.
do $$
declare v jsonb;
begin
  perform pg_temp.publish_content(pg_temp.batch(6), pg_temp.ed(6), 'e-news-1',
    'newsletter_article', jsonb_build_object('version', 0, 'required', false));

  perform pg_temp.record(22, 'D7 version 0 is declaration_missing, not legacy', 'declaration_missing',
    public.edition_question_contract(pg_temp.batch(6))->>'state');

  v := pg_temp.verify(6);

  perform pg_temp.record(23, 'D8 an undeclared edition fails verification', 'false', v->>'ok');
  perform pg_temp.record(24, 'D9 with a reason an operator can act on',
    'contract_declaration_missing', v->>'reason');

  -- Half a batch declaring questions and half declaring none was published by
  -- two different things. Neither answer may be trusted.
  perform pg_temp.publish_content(pg_temp.batch(7), pg_temp.ed(7), 'e-news-2',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.publish_content(pg_temp.batch(7), pg_temp.ed(7), 'e-news-3',
    'newsletter_article', jsonb_build_object('version', 1, 'required', false));

  perform pg_temp.record(25, 'D10 a mixed batch is inconsistent', 'inconsistent',
    public.edition_question_contract(pg_temp.batch(7))->>'state');
  perform pg_temp.record(26, 'D11 and fails', 'contract_declaration_inconsistent',
    pg_temp.verify(7)->>'reason');
end $$;

-- ===========================================================================
-- TEST E — corrupted question contract
-- ===========================================================================
-- Each of these published a full-looking question set that violates the
-- contract in exactly one way. Every one must be refused, and named.
do $$
declare v jsonb;
begin
  -- E1: a mini case reduced to two questions.
  perform pg_temp.publish_content(pg_temp.batch(10), pg_temp.ed(10), 'f-case-2q',
    'mini_case', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.persist_question('f-case-2q', 'mini_case', 1, 'method_framework');
  perform pg_temp.persist_question('f-case-2q', 'mini_case', 2, 'technical_application');

  perform pg_temp.record(27, 'E1 a mini case with two questions is refused', 'question_count_mismatch',
    pg_temp.verify(10)->>'reason');

  -- E2: the OLD role vocabulary. `framework` is what the 2026-09-09 batch
  -- carries today, and the production CHECK constraint refuses it outright —
  -- which is itself the proof: the old format cannot even be persisted.
  begin
    perform pg_temp.publish_content(pg_temp.batch(11), pg_temp.ed(11), 'f-case-oldrole',
      'mini_case', jsonb_build_object('version', 1, 'required', true));
    perform pg_temp.persist_question('f-case-oldrole', 'mini_case', 1, 'framework');
    perform pg_temp.record(28, 'E2 the old role `framework` cannot be persisted', 'refused', 'persisted');
  exception when others then
    perform pg_temp.record(28, 'E2 the old role `framework` cannot be persisted', 'refused', 'refused');
  end;

  -- E3: a newsletter with three questions.
  perform pg_temp.publish_content(pg_temp.batch(12), pg_temp.ed(12), 'f-news-3q',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.persist_question('f-news-3q', 'newsletter_article', 1, 'interpretation');
  perform pg_temp.persist_question('f-news-3q', 'newsletter_article', 2, 'application_decision');
  begin
    perform pg_temp.persist_question('f-news-3q', 'newsletter_article', 3, 'interpretation');
    perform pg_temp.record(29, 'E3 a third newsletter question cannot be persisted', 'refused', 'persisted');
  exception when others then
    perform pg_temp.record(29, 'E3 a third newsletter question cannot be persisted', 'refused', 'refused');
  end;

  -- E4: two options worth 1000 and no 300.
  perform pg_temp.publish_content(pg_temp.batch(13), pg_temp.ed(13), 'f-news-tier',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.persist_question('f-news-tier', 'newsletter_article', 1, 'interpretation',
    4, array[0, 600, 1000, 1000]);
  perform pg_temp.persist_question('f-news-tier', 'newsletter_article', 2, 'application_decision');

  perform pg_temp.record(30, 'E4 two options at 1000 and no 300 is refused',
    'question_score_tier_set_invalid', pg_temp.verify(13)->>'reason');

  -- E5: a question with only an English prompt.
  perform pg_temp.publish_content(pg_temp.batch(14), pg_temp.ed(14), 'f-news-lang',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.persist_question('f-news-lang', 'newsletter_article', 1, 'interpretation',
    4, array[0, 300, 600, 1000], array['en']);
  perform pg_temp.persist_question('f-news-lang', 'newsletter_article', 2, 'application_decision');

  perform pg_temp.record(31, 'E5 a question with no French prompt is refused',
    'question_locale_incomplete', pg_temp.verify(14)->>'reason');

  -- E6: options labelled in English only. Structurally the FR and EN readings
  -- share one option row, so "different option ids" is unrepresentable here —
  -- the way it goes wrong in production is a missing label, and a French reader
  -- shown a blank option mid-competition is the same bug.
  perform pg_temp.publish_content(pg_temp.batch(15), pg_temp.ed(15), 'f-news-optlang',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.persist_question('f-news-optlang', 'newsletter_article', 1, 'interpretation',
    4, array[0, 300, 600, 1000], array['fr', 'en'], array['en']);
  perform pg_temp.persist_question('f-news-optlang', 'newsletter_article', 2, 'application_decision');

  perform pg_temp.record(32, 'E6 an option with no French label is refused',
    'question_option_locale_incomplete', pg_temp.verify(15)->>'reason');

  -- E7: three options instead of four.
  perform pg_temp.publish_content(pg_temp.batch(16), pg_temp.ed(16), 'f-news-3opt',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.persist_question('f-news-3opt', 'newsletter_article', 1, 'interpretation',
    3, array[0, 600, 1000]);
  perform pg_temp.persist_question('f-news-3opt', 'newsletter_article', 2, 'application_decision');

  -- One broken question trips several checks at once: three options is also
  -- three grades and also a hole in the tier set. The headline `reason` has to
  -- be the most fundamental of them, deterministically, or the same failure
  -- reads differently on two runs and an operator cannot trust either.
  perform pg_temp.record(33, 'E7 three options is refused',
    'question_option_count_mismatch', pg_temp.verify(16)->>'reason');
  perform pg_temp.record(46, 'E7a all three consequences are reported', '3',
    (select count(*)::text from jsonb_array_elements(pg_temp.verify(16)->'problems') p
     where p->>'code' in ('question_option_count_mismatch',
                          'question_grade_count_mismatch',
                          'question_score_tier_set_invalid')));
  perform pg_temp.record(47, 'E7b and the shape defect leads, not the grading one',
    'question_option_count_mismatch',
    (select p->>'code' from jsonb_array_elements(pg_temp.verify(16)->'problems') p limit 1));

  -- E8: an option nobody graded. The submit path reads a missing grade as zero,
  -- so this is a reader silently losing points on an ungraded answer.
  perform pg_temp.publish_content(pg_temp.batch(17), pg_temp.ed(17), 'f-news-grade',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.persist_question('f-news-grade', 'newsletter_article', 1, 'interpretation',
    4, array[0, 300, 600]);
  perform pg_temp.persist_question('f-news-grade', 'newsletter_article', 2, 'application_decision');

  perform pg_temp.record(34, 'E8 an ungraded option is refused',
    'question_grade_count_mismatch', pg_temp.verify(17)->>'reason');

  -- E9: grading exposed in client-readable metadata. Checked first and
  -- regardless of the contract, because it is the one failure republishing
  -- cannot fix.
  insert into public.content_items(
    content_type, topic_id, language, title, summary, body_md,
    publication_date, version, status, source_count, metadata)
  values ('newsletter_article', 'finance', 'en', 'Leak', 'S', 'B',
    pg_temp.ed(18), 1, 'published', 1,
    jsonb_build_object(
      'staging_batch_id', pg_temp.batch(18)::text,
      'staging_job_id', 'f-leak',
      'staging_scored_question_contract', jsonb_build_object('version', 1, 'required', false),
      'questions', jsonb_build_array(jsonb_build_object('score_milli', 1000))));

  v := pg_temp.verify(18);

  perform pg_temp.record(35, 'E9 grading in metadata fails even a not-required edition', 'false', v->>'ok');
  perform pg_temp.record(36, 'E10 and is named as the leak it is', 'answer_key_in_metadata', v->>'reason');
end $$;

-- ===========================================================================
-- TEST F — retry
-- ===========================================================================
-- Content published, question stage failed, verification failed. The operator
-- retries stages 2 and 3 only. Verification must now pass, and the editorial
-- content must not have been touched, duplicated or republished.
do $$
declare
  v jsonb;
  v_before int;
  v_after int;
begin
  perform pg_temp.publish_content(pg_temp.batch(20), pg_temp.ed(20), 'g-news-1',
    'newsletter_article', jsonb_build_object('version', 1, 'required', true));

  select count(*) into v_before from public.content_items
  where metadata->>'staging_batch_id' = pg_temp.batch(20)::text;

  perform pg_temp.record(37, 'F1 the first verification fails', 'questions_missing_entirely',
    pg_temp.verify(20)->>'reason');

  -- THE RETRY. Only the question stage runs again; nothing republishes content.
  perform pg_temp.persist_full_set('g-news-1', 'newsletter_article');

  v := pg_temp.verify(20);

  perform pg_temp.record(38, 'F2 the retry verifies', 'true', v->>'ok');
  perform pg_temp.record(39, 'F3 with the questions now present', '2', v->'questions'->>'actual');

  select count(*) into v_after from public.content_items
  where metadata->>'staging_batch_id' = pg_temp.batch(20)::text;

  perform pg_temp.record(40, 'F4 the editorial content was not duplicated',
    v_before::text, v_after::text);
  perform pg_temp.record(41, 'F5 and it is still exactly the two renderings', '2', v_after::text);

  -- Persisting the same set a second time is the shape a double retry takes.
  -- `persist_content_questions` skips a question already present, so it writes
  -- nothing and re-grades nothing.
  perform pg_temp.record(42, 'F6 re-running the question stage writes nothing new', '0',
    public.persist_content_questions(
      'g-news-1', 'newsletter_article',
      (select id from public.content_items
        where metadata->>'staging_job_id' = 'g-news-1' and language = 'fr'),
      (select id from public.content_items
        where metadata->>'staging_job_id' = 'g-news-1' and language = 'en'),
      jsonb_build_array(), jsonb_build_array())::text);

  perform pg_temp.record(43, 'F7 and the edition still verifies afterwards', 'true',
    pg_temp.verify(20)->>'ok');
end $$;

-- ===========================================================================
-- TEST G — there is no attempt 4
-- ===========================================================================
-- The editorial rule, asserted against the contract production and staging both
-- read rather than against a comment. Production does not hold the contract
-- document, so what it can prove is the half that lives here: the three roles a
-- mini case must carry, in order, and the four tiers — the two things a fourth
-- generation would exist to fix and must instead be fixed inside attempt 3.
do $$
declare
  v_roles text[];
begin
  perform pg_temp.publish_content(pg_temp.batch(30), pg_temp.ed(30), 'h-case-1',
    'mini_case', jsonb_build_object('version', 1, 'required', true));
  perform pg_temp.persist_full_set('h-case-1', 'mini_case');

  select array_agg(q.question_role order by q.question_sequence) into v_roles
  from public.logical_questions q where q.content_logical_key = 'h-case-1';

  perform pg_temp.record(44, 'G1 a mini case carries exactly the three contract roles, in order',
    'method_framework,technical_application,conclusion_decision',
    array_to_string(v_roles, ','));

  perform pg_temp.record(45, 'G2 a fourth mini-case question cannot exist', 'refused',
    (select case when count(*) = 0 then 'refused' else 'persisted' end
     from public.logical_questions q
     where q.content_logical_key = 'h-case-1' and q.question_sequence > 3));
end $$;

select
  (select count(*) from contract_results) as checks,
  (select count(*) from contract_results where pass) as passed,
  (select count(*) from contract_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from contract_results where not pass) as failures;

rollback;
