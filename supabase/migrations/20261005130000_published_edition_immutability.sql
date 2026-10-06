-- Published editions are immutable.
--
-- THE INVARIANT
--
-- Once an edition date is published (it has a row in public.editions), no
-- ordinary code path may rewrite its reader assignments: the daily_drops rows
-- for that date and the daily_drop_items behind them. Readers have read them,
-- answered their questions and scored on them; Team play and the notification
-- schedule are keyed on them.
--
-- WHAT WAS WRONG
--
-- Nothing enforced it. publish_scheduled_staging_payload upserted every
-- reader's drop on (user_id, drop_date) and then DELETED and re-inserted its
-- items, guarded only by a per-batch advisory lock and the staging receipt.
-- A second batch for the same date, the legacy direct-API daily job
-- (contentRepository.insertDailyDrop + replaceDailyDropItems) or the old
-- break-glass staging-publish CLI could all replace a published edition's
-- items silently.
--
-- WHAT THIS DOES
--
-- 1. editions.staging_batch_id records which staging batch published a date.
--    The canonical publisher announces its batch in a transaction-local
--    setting, personews.publishing_batch_id, and the existing registration
--    trigger stamps it on the editions row it creates. Older rows stay NULL and
--    are resolved from their items' content metadata (edition_batch_id).
--
-- 2. Guard triggers on daily_drops, daily_drop_items and editions refuse any
--    INSERT/UPDATE/DELETE touching a published date, unless
--      - the writer is the canonical publisher re-running the SAME batch
--        (personews.publishing_batch_id = the edition's batch), or
--      - an operator has explicitly opened a transaction-local override:
--          begin;
--          set local personews.allow_edition_rewrite = 'on';
--          ... the deliberate repair ...
--          commit;
--        Default off; `set local` dies with the transaction; no client can
--        reach it (clients hold no write privilege on these tables and cannot
--        run SET through PostgREST).
--    Deletes cascading from an account deletion are always allowed: GDPR
--    erasure must never be blocked by edition immutability.
--
-- 3. The publisher is restated in full (no text patching):
--      - a per-edition-date advisory lock beside the per-batch one, so two
--        different batches for one date serialise instead of racing;
--      - a refusal when the date is already published by a DIFFERENT batch;
--      - a same-batch retry only fills readers who have no drop yet. It never
--        deletes or rewrites a drop that already exists for a published date.
--    Everything else in the function is byte-for-byte the definition that
--    20260826174155 + 20260906100000 + 20260907180000 produce.
--
-- Additive, forward-only. No existing row is changed.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Which batch published an edition
-- ---------------------------------------------------------------------------

ALTER TABLE public.editions
  ADD COLUMN IF NOT EXISTS staging_batch_id UUID;

COMMENT ON COLUMN public.editions.staging_batch_id IS
  'The staging batch whose canonical publication registered this edition. NULL for editions registered before 20261005130000; edition_batch_id() resolves those from content metadata.';

CREATE OR REPLACE FUNCTION public.edition_publishing_batch()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN current_setting('personews.publishing_batch_id', true)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('personews.publishing_batch_id', true)::uuid
  END;
$$;

COMMENT ON FUNCTION public.edition_publishing_batch() IS
  'The staging batch the current transaction is publishing, as announced by publish_scheduled_staging_payload through the transaction-local setting personews.publishing_batch_id. NULL otherwise.';

CREATE OR REPLACE FUNCTION public.edition_batch_id(p_edition_date DATE)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT e.staging_batch_id FROM public.editions e WHERE e.edition_date = p_edition_date),
    (SELECT (ci.metadata->>'staging_batch_id')::uuid
     FROM public.daily_drops dd
     JOIN public.daily_drop_items ddi ON ddi.daily_drop_id = dd.id
     JOIN public.content_items ci ON ci.id = ddi.content_item_id
     WHERE dd.drop_date = p_edition_date
       AND ci.metadata->>'staging_batch_id'
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     ORDER BY dd.created_at, ddi.position
     LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.edition_batch_id(DATE) IS
  'The staging batch that published an edition date: editions.staging_batch_id, or for older editions the batch recorded on the content its drops carry. NULL when no batch can be named (pre-staging editions).';

CREATE OR REPLACE FUNCTION public.edition_rewrite_allowed(p_edition_date DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_publishing UUID;
BEGIN
  IF p_edition_date IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.editions e WHERE e.edition_date = p_edition_date) THEN
    RETURN TRUE;
  END IF;

  IF current_setting('personews.allow_edition_rewrite', true) = 'on' THEN
    RETURN TRUE;
  END IF;

  v_publishing := public.edition_publishing_batch();

  RETURN v_publishing IS NOT NULL
     AND v_publishing = public.edition_batch_id(p_edition_date);
END;
$$;

COMMENT ON FUNCTION public.edition_rewrite_allowed(DATE) IS
  'True when the current transaction may write reader assignments for this date: the date is not published, or the canonical publisher is re-running the batch that published it, or an operator set personews.allow_edition_rewrite = ''on'' for this transaction.';

CREATE OR REPLACE FUNCTION public.raise_published_edition_immutable(p_edition_date DATE, p_what TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'edition % is published and immutable: % refused', p_edition_date, p_what
    USING ERRCODE = '55000',
          HINT = 'Recover by re-running the canonical scheduled publisher for the SAME batch '
              || '(staging: select public.run_scheduled_publication_tick(true)). An intentional '
              || 'operator rewrite needs: begin; set local personews.allow_edition_rewrite = ''on''; ... commit;';
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Stamp the publishing batch on the edition it registers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_edition_from_daily_drop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.editions (edition_date, edition_kind, published_at, staging_batch_id)
  VALUES (
    NEW.drop_date,
    COALESCE(public.resolve_edition_kind(NEW.drop_date), 'daily'),
    COALESCE(NEW.published_at, now()),
    public.edition_publishing_batch()
  )
  ON CONFLICT (edition_date) DO NOTHING;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Guards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_published_edition_drops()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Account deletion cascades profiles -> daily_drops. Erasure always wins.
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RETURN OLD;
    END IF;

    IF NOT public.edition_rewrite_allowed(OLD.drop_date) THEN
      PERFORM public.raise_published_edition_immutable(OLD.drop_date, 'deleting a reader''s drop');
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NOT public.edition_rewrite_allowed(OLD.drop_date) THEN
    PERFORM public.raise_published_edition_immutable(OLD.drop_date, 'changing a reader''s drop');
  END IF;

  IF NOT public.edition_rewrite_allowed(NEW.drop_date) THEN
    PERFORM public.raise_published_edition_immutable(NEW.drop_date,
      CASE TG_OP WHEN 'INSERT' THEN 'adding a drop' ELSE 'moving a drop' END);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_published_edition_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date DATE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT dd.drop_date INTO v_date FROM public.daily_drops dd WHERE dd.id = OLD.daily_drop_id;

    -- The drop itself is being deleted (its own guard already ruled on that,
    -- e.g. an account deletion): its items follow.
    IF NOT FOUND THEN
      RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF NOT public.edition_rewrite_allowed(v_date) THEN
      PERFORM public.raise_published_edition_immutable(v_date,
        CASE TG_OP WHEN 'DELETE' THEN 'removing an item' ELSE 'changing an item' END);
    END IF;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
  END IF;

  SELECT dd.drop_date INTO v_date FROM public.daily_drops dd WHERE dd.id = NEW.daily_drop_id;

  IF FOUND AND NOT public.edition_rewrite_allowed(v_date) THEN
    PERFORM public.raise_published_edition_immutable(v_date, 'adding an item');
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_edition_registry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('personews.allow_edition_rewrite', true) IS DISTINCT FROM 'on' THEN
    PERFORM public.raise_published_edition_immutable(OLD.edition_date,
      CASE TG_OP WHEN 'DELETE' THEN 'deleting the edition record' ELSE 'changing the edition record' END);
  END IF;

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_drops_guard_published_edition ON public.daily_drops;
CREATE TRIGGER trg_daily_drops_guard_published_edition
BEFORE INSERT OR UPDATE OR DELETE ON public.daily_drops
FOR EACH ROW EXECUTE FUNCTION public.guard_published_edition_drops();

DROP TRIGGER IF EXISTS trg_daily_drop_items_guard_published_edition ON public.daily_drop_items;
CREATE TRIGGER trg_daily_drop_items_guard_published_edition
BEFORE INSERT OR UPDATE OR DELETE ON public.daily_drop_items
FOR EACH ROW EXECUTE FUNCTION public.guard_published_edition_items();

DROP TRIGGER IF EXISTS trg_editions_guard_registry ON public.editions;
CREATE TRIGGER trg_editions_guard_registry
BEFORE UPDATE OR DELETE ON public.editions
FOR EACH ROW EXECUTE FUNCTION public.guard_edition_registry();

DO $grants$
DECLARE
  v_signature TEXT;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.edition_publishing_batch()',
    'public.edition_batch_id(DATE)',
    'public.edition_rewrite_allowed(DATE)',
    'public.raise_published_edition_immutable(DATE, TEXT)',
    'public.guard_published_edition_drops()',
    'public.guard_published_edition_items()',
    'public.guard_edition_registry()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
  END LOOP;
END;
$grants$;

-- ---------------------------------------------------------------------------
-- 4. The canonical publisher, restated in full
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.publish_scheduled_staging_payload(p_payload jsonb, p_run_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_batch jsonb;
  v_jobs jsonb;
  v_batch_id uuid;
  v_edition_date date;
  v_edition_kind text;
  v_target_ref text;
  v_job_rec record;
  v_job jsonb;
  v_item jsonb;
  v_review jsonb;
  v_checks jsonb;
  v_content_type text;
  v_lang text;
  v_topic text;
  v_difficulty text;
  v_summary text;
  v_body text;
  v_metadata jsonb;
  v_dedup_key text;
  v_content_item_id uuid;
  v_source_id uuid;
  v_source_rec jsonb;
  v_source_url text;
  v_source_ord bigint;
  v_items_written integer := 0;
  v_items_reused integer := 0;
  v_source_links integer := 0;
  v_drops_written integer := 0;
  v_drop_items integer := 0;
  v_news_count integer;
  v_story_count integer;
  v_case_count integer;
  v_case_topic_count integer;
  v_user record;
  v_topic_pref record;
  v_candidate record;
  v_drop_id uuid;
  v_news_position integer;
  v_topic_limit integer;
  v_business_id uuid;
  v_mini_id uuid;
  v_memory jsonb;
  v_edition_existed boolean := false;
  v_existing_batch uuid;
  v_drops_skipped integer := 0;
begin
  if coalesce(p_run_id, '') = '' then
    raise exception 'scheduled publish refused: run id is required';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or coalesce(p_payload->>'ready','false') <> 'true' then
    raise exception 'scheduled publish refused: payload is not ready';
  end if;

  v_batch := p_payload->'batch';
  v_jobs := p_payload->'jobs';

  if jsonb_typeof(v_batch) <> 'object' or jsonb_typeof(v_jobs) <> 'array' then
    raise exception 'scheduled publish refused: malformed batch payload';
  end if;

  v_batch_id := (v_batch->>'id')::uuid;
  v_edition_date := (v_batch->>'edition_date')::date;
  v_edition_kind := v_batch->>'edition_kind';
  v_target_ref := v_batch->>'target_project_ref';

  if v_edition_kind not in ('daily','weekly_digest') then
    raise exception 'scheduled publish refused: unsupported edition kind %', v_edition_kind;
  end if;

  if v_target_ref is not null and v_target_ref <> '' and v_target_ref <> 'wkbviidrbmehmjbhvpeh' then
    raise exception 'scheduled publish refused: batch targets %, not production', v_target_ref;
  end if;

  if jsonb_array_length(v_jobs) <> 23 then
    raise exception 'scheduled publish refused: expected 23 jobs, got %', jsonb_array_length(v_jobs);
  end if;

  select
    count(*) filter (where j->>'content_type'='newsletter_article'),
    count(*) filter (where j->>'content_type'='business_story'),
    count(*) filter (where j->>'content_type'='mini_case'),
    count(distinct j->>'mini_case_topic') filter (where j->>'content_type'='mini_case')
  into v_news_count,v_story_count,v_case_count,v_case_topic_count
  from jsonb_array_elements(v_jobs) j;

  if v_news_count <> 16 or v_story_count <> 1 or v_case_count <> 6 or v_case_topic_count <> 6 then
    raise exception 'scheduled publish refused: composition is newsletter %, story %, mini %, mini topics %',
      v_news_count,v_story_count,v_case_count,v_case_topic_count;
  end if;

  if exists (
    select 1
    from (
      select j->>'topic' as topic, count(*) as c
      from jsonb_array_elements(v_jobs) j
      where j->>'content_type'='newsletter_article'
      group by j->>'topic'
    ) q
    where q.c <> 2 or q.topic not in ('business','finance','tech_ai','law','medicine','engineering','sport_business','culture_media')
  ) or (
    select count(distinct j->>'topic')
    from jsonb_array_elements(v_jobs) j
    where j->>'content_type'='newsletter_article'
  ) <> 8 then
    raise exception 'scheduled publish refused: newsletter topic composition is invalid';
  end if;


  -- One publisher per batch AND one per edition date: two different batches
  -- for the same date serialise here instead of racing.
  perform pg_advisory_xact_lock(hashtext(v_batch_id::text));
  perform pg_advisory_xact_lock(hashtext('personews:edition:' || v_edition_date::text));

  -- A published date belongs to the batch that published it. The same batch
  -- may come back (a retry after a timeout) and only fill what is missing; a
  -- different batch is refused rather than allowed to replace what readers have.
  v_edition_existed := exists (select 1 from public.editions e where e.edition_date = v_edition_date);

  if v_edition_existed then
    v_existing_batch := public.edition_batch_id(v_edition_date);

    if v_existing_batch is distinct from v_batch_id then
      raise exception 'scheduled publish refused: edition % is already published by batch %; batch % cannot replace it',
        v_edition_date, coalesce(v_existing_batch::text, '<unknown>'), v_batch_id
        using errcode = '55000',
              hint = 'Published editions are immutable. Investigate why a second batch exists for this date.';
    end if;
  end if;

  -- Tell the edition registry and the immutability guards which batch this
  -- transaction publishes. Transaction-local: gone at commit or rollback.
  perform set_config('personews.publishing_batch_id', v_batch_id::text, true);


  for v_job_rec in
    select value as job, ordinality as ord
    from jsonb_array_elements(v_jobs) with ordinality
  loop
    v_job := v_job_rec.job;
    v_content_type := v_job->>'content_type';
    v_review := v_job->'review';
    v_checks := v_review->'checks';

    if v_content_type not in ('newsletter_article','business_story','mini_case') then
      raise exception 'scheduled publish refused: unsupported content type %', v_content_type;
    end if;

    if coalesce(v_review->>'verdict','') <> 'approved'
       or coalesce((v_review->>'score')::numeric,0) < 90
       or coalesce(v_checks->>'source_grounding','false') <> 'true'
       or coalesce(v_checks->>'factual_accuracy','false') <> 'true'
       or coalesce(v_checks->>'safety','false') <> 'true'
       or coalesce(v_checks->>'schema','false') <> 'true'
       or coalesce(v_checks->>'fr_en_parity','false') <> 'true'
       or coalesce(v_checks->>'novelty_anti_repetition','false') <> 'true'
    then
      raise exception 'scheduled publish refused: job % review is below bar', v_job->>'job_id';
    end if;

    if jsonb_typeof(v_job->'source_records') <> 'array' or jsonb_array_length(v_job->'source_records') = 0 then
      raise exception 'scheduled publish refused: job % has no source records', v_job->>'job_id';
    end if;

    for v_source_rec in select value from jsonb_array_elements(v_job->'source_records')
    loop
      v_source_url := nullif(trim(v_source_rec->>'url'),'');
      if v_source_url is null then
        raise exception 'scheduled publish refused: job % contains a blank source URL', v_job->>'job_id';
      end if;

      insert into public.sources(
        url,title,publisher,author,published_at,retrieved_at,language,credibility_score,content_hash
      ) values (
        v_source_url,
        nullif(v_source_rec->>'title',''),
        nullif(v_source_rec->>'publisher',''),
        null,
        nullif(v_source_rec->>'published_at','')::timestamptz,
        coalesce(nullif(v_source_rec->>'retrieved_at','')::timestamptz,now()),
        case when v_source_rec->>'language' in ('fr','en') then v_source_rec->>'language' else null end,
        0.6,
        md5(v_source_url)
      )
      on conflict (url) do update set
        title=coalesce(excluded.title,public.sources.title),
        publisher=coalesce(excluded.publisher,public.sources.publisher),
        published_at=coalesce(excluded.published_at,public.sources.published_at),
        retrieved_at=greatest(public.sources.retrieved_at,excluded.retrieved_at),
        language=coalesce(excluded.language,public.sources.language),
        content_hash=coalesce(public.sources.content_hash,excluded.content_hash),
        updated_at=now();
    end loop;

    foreach v_lang in array array['fr','en']
    loop
      v_item := v_job->'output_json'->v_lang;
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'scheduled publish refused: job % missing % item', v_job->>'job_id',v_lang;
      end if;
      if coalesce(v_item->>'language','') <> v_lang or coalesce(v_item->>'content_type','') <> v_content_type then
        raise exception 'scheduled publish refused: job % % identity mismatch', v_job->>'job_id',v_lang;
      end if;
      if nullif(trim(v_item->>'title'),'') is null or nullif(trim(v_item->>'body_md'),'') is null then
        raise exception 'scheduled publish refused: job % % missing title/body', v_job->>'job_id',v_lang;
      end if;
      if jsonb_typeof(v_item->'source_urls') <> 'array' or jsonb_array_length(v_item->'source_urls')=0 then
        raise exception 'scheduled publish refused: job % % has no source URLs', v_job->>'job_id',v_lang;
      end if;
      if exists (
        select 1
        from jsonb_array_elements_text(v_item->'source_urls') u(url)
        where not exists (
          select 1 from jsonb_array_elements(v_job->'source_records') r
          where r->>'url'=u.url
        )
      ) then
        raise exception 'scheduled publish refused: job % % cites an unrecorded source', v_job->>'job_id',v_lang;
      end if;

      v_topic := nullif(v_item->>'topic','');
      if v_topic is null or not exists(select 1 from public.topics t where t.id=v_topic) then
        raise exception 'scheduled publish refused: job % % has invalid topic %', v_job->>'job_id',v_lang,v_topic;
      end if;

      v_body := v_item->>'body_md';
      v_summary := case v_content_type
        when 'newsletter_article' then nullif(v_item->>'summary','')
        when 'business_story' then nullif(v_item->>'lesson','')
        when 'mini_case' then nullif(v_item->>'challenge','')
      end;

      if v_content_type='mini_case' then
        v_difficulty := case lower(coalesce(v_item->>'difficulty',''))
          when 'easy' then 'easy'
          when 'medium' then 'medium'
          when 'intermediate' then 'medium'
          when 'hard' then 'hard'
          else null
        end;
        if v_difficulty is null then
          raise exception 'scheduled publish refused: job % % has unsupported difficulty %', v_job->>'job_id',v_lang,v_item->>'difficulty';
        end if;
      else
        v_difficulty := null;
      end if;

      v_dedup_key := 'staging:'||v_batch_id::text||':'||(v_job->>'job_id')||':'||v_lang;
      v_metadata := (v_item - 'body_md' - 'title' - 'summary' - 'language' - 'content_type' - 'topic' - 'version' - 'difficulty' - 'questions')
        || jsonb_build_object(
          'is_test_data',false,
          'scheduler_mode','scheduled-reviewer-publish-rpc',
          'scheduler_run_id',p_run_id,
          'content_status','published',
          'generator','chatgpt_scheduled',
          'model_name',null,
          'staging_batch_id',v_batch_id::text,
          'staging_job_id',v_job->>'job_id',
          'staging_output_id',v_job->>'output_id',
          'staging_prompt_version',v_job->>'prompt_version',
          'staging_review_score',(v_review->>'score')::numeric,
          'staging_reviewer_id',v_review->>'reviewer_id',
          'staging_edition_kind',v_edition_kind,
          'staging_prompt_bundle_version',v_batch->>'prompt_bundle_version',
          'staging_ordinal',coalesce((v_job->>'ordinal')::integer,v_job_rec.ord::integer),
          'dedup_key',v_dedup_key,
          'persisted_by','public.publish_scheduled_staging_payload',
          'staging_scored_question_contract',public.scored_question_declaration(p_payload->'batch')
        );

      select id into v_content_item_id
      from public.content_items
      where metadata->>'dedup_key'=v_dedup_key and status<>'archived'
      limit 1;

      if v_content_item_id is null then
        insert into public.content_items(
          content_type,topic_id,language,title,summary,body_md,difficulty,
          estimated_read_seconds,publication_date,version,status,generation_run_id,source_count,metadata
        ) values (
          v_content_type,v_topic,v_lang,v_item->>'title',v_summary,v_body,v_difficulty,
          greatest(30,ceil((coalesce(array_length(regexp_split_to_array(trim(v_body),E'\\s+'),1),1)::numeric/220)*60)::integer),
          v_edition_date,coalesce((v_item->>'version')::integer,1),'published',null,
          jsonb_array_length(v_item->'source_urls'),v_metadata
        ) returning id into v_content_item_id;
        v_items_written := v_items_written+1;
      else
        v_items_reused := v_items_reused+1;
      end if;

      for v_source_url,v_source_ord in
        select value,ordinality
        from jsonb_array_elements_text(v_item->'source_urls') with ordinality
      loop
        select id into v_source_id from public.sources where url=v_source_url;
        if v_source_id is null then
          raise exception 'scheduled publish refused: persisted source missing for %',v_source_url;
        end if;
        insert into public.content_item_sources(content_item_id,source_id,claim,source_order)
        values(v_content_item_id,v_source_id,null,(v_source_ord-1)::integer)
        on conflict do nothing;
        if found then v_source_links:=v_source_links+1; end if;
      end loop;

      if v_content_type='business_story' then
        v_memory:=v_item->'editorial_memory';
        if jsonb_typeof(v_memory)='object'
          and nullif(trim(v_memory->>'entity_name'),'') is not null
          and nullif(trim(v_memory->>'main_company'),'') is not null
          and nullif(trim(v_memory->>'industry'),'') is not null
          and nullif(trim(v_memory->>'key_mechanism'),'') is not null
          and nullif(trim(v_memory->>'strategic_angle'),'') is not null
          and nullif(trim(v_memory->>'core_takeaway'),'') is not null
          and nullif(trim(v_memory->>'year_period'),'') is not null
        then
          insert into public.business_story_history(
            content_item_id,title,slug,entity_name,entity_type,main_company,companies_mentioned,
            industry,key_mechanism,secondary_mechanisms,strategic_angle,core_takeaway,year_period,language,published_date
          ) values(
            v_content_item_id,v_item->>'title','staging-'||v_batch_id::text||'-'||(v_job->>'job_id')||'-'||v_lang,
            v_memory->>'entity_name',
            case when v_memory->>'entity_type' in ('founder','ceo','investor','company','product','crisis','acquisition','strategy','other') then v_memory->>'entity_type' else 'other' end,
            v_memory->>'main_company',
            case when jsonb_typeof(v_memory->'companies_mentioned')='array' then array(select jsonb_array_elements_text(v_memory->'companies_mentioned')) else array[]::text[] end,
            v_memory->>'industry',v_memory->>'key_mechanism',
            case when jsonb_typeof(v_memory->'secondary_mechanisms')='array' then array(select jsonb_array_elements_text(v_memory->'secondary_mechanisms')) else array[]::text[] end,
            v_memory->>'strategic_angle',v_memory->>'core_takeaway',v_memory->>'year_period',v_lang,v_edition_date
          ) on conflict do nothing;
        end if;
      elsif v_content_type='mini_case' then
        if v_item->>'product_topic' in ('finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations')
          and v_item->>'scenario_type' in ('acquisition_decision','pricing_decision','compliance_risk','capital_allocation','product_launch','market_entry','cost_optimization','clinical_trial_decision','supply_chain_constraint','ai_build_vs_buy','portfolio_risk','contract_negotiation','capacity_planning')
          and v_item->>'decision_type' in ('choose_metric','choose_strategy','identify_risk','rank_options','reject_bad_assumption','interpret_result','allocate_budget','choose_next_step')
          and v_item->>'concept_tested' in ('margin','cash_flow','valuation_multiple','risk_adjusted_return','regulatory_risk','privacy_compliance','opportunity_cost','switching_cost','bottleneck','sensitivity_analysis','market_liquidity','trial_endpoint','unit_economics')
          and v_item->>'question_pattern' in ('framework_then_apply_then_decide','diagnose_then_prioritize_then_recommend','metric_then_tradeoff_then_next_step','risk_then_evidence_then_decision','reject_assumption_then_test_then_conclude')
          and v_item->>'correct_answer_pattern' in ('best_next_signal','least_risky_option','highest_expected_value','constraint_first','evidence_before_action','reject_overconfident_claim')
          and nullif(trim(v_item->>'mechanism'),'') is not null
          and nullif(trim(v_item->>'core_takeaway'),'') is not null
        then
          insert into public.mini_case_history(
            content_item_id,title,slug,topic,scenario_type,decision_type,concept_tested,mechanism,difficulty,
            question_pattern,correct_answer_pattern,core_takeaway,published_date,language
          ) values(
            v_content_item_id,v_item->>'title','staging-'||v_batch_id::text||'-'||(v_job->>'job_id')||'-'||v_lang,
            v_item->>'product_topic',v_item->>'scenario_type',v_item->>'decision_type',v_item->>'concept_tested',
            v_item->>'mechanism',v_difficulty,v_item->>'question_pattern',v_item->>'correct_answer_pattern',
            v_item->>'core_takeaway',v_edition_date,v_lang
          ) on conflict do nothing;
        end if;
      end if;
    end loop;
  end loop;


  for v_user in
    select p.id,p.language,up.newsletter_enabled,up.business_stories_enabled,up.mini_cases_enabled,up.newsletter_article_count
    from public.profiles p
    join public.user_preferences up on up.user_id=p.id
    where p.language in ('fr','en')
    order by p.id
  loop
    -- A retry of a published edition never touches a reader who already has
    -- their drop: it only completes the readers a failed attempt did not reach.
    if v_edition_existed and exists (
      select 1 from public.daily_drops d where d.user_id = v_user.id and d.drop_date = v_edition_date
    ) then
      v_drops_skipped := v_drops_skipped + 1;
      continue;
    end if;

    insert into public.daily_drops(user_id,drop_date,language,status,generated_at,published_at,hide_display_date,updated_at)
    values(v_user.id,v_edition_date,v_user.language,'published',now(),now(),false,now())
    on conflict(user_id,drop_date) do update set
      language=excluded.language,status='published',published_at=now(),hide_display_date=false,updated_at=now()
    returning id into v_drop_id;

    delete from public.daily_drop_items where daily_drop_id=v_drop_id;
    v_news_position:=0;

    if v_user.newsletter_enabled then
      for v_topic_pref in
        select topic_id,articles_count
        from public.user_topic_preferences
        where user_id=v_user.id and enabled=true
        order by position nulls last,topic_id
      loop
        exit when v_news_position >= v_user.newsletter_article_count;
        v_topic_limit:=least(2,greatest(1,v_topic_pref.articles_count));
        for v_candidate in
          select id
          from public.content_items
          where status='published'
            and publication_date=v_edition_date
            and language=v_user.language
            and content_type='newsletter_article'
            and topic_id=v_topic_pref.topic_id
            and metadata->>'staging_batch_id'=v_batch_id::text
          order by coalesce((metadata->>'staging_ordinal')::integer,999),id
          limit v_topic_limit
        loop
          exit when v_news_position >= v_user.newsletter_article_count;
          insert into public.daily_drop_items(daily_drop_id,content_item_id,slot,position)
          values(v_drop_id,v_candidate.id,'newsletter',v_news_position)
          on conflict do nothing;
          if found then v_drop_items:=v_drop_items+1; end if;
          v_news_position:=v_news_position+1;
        end loop;
      end loop;
    end if;

    if v_user.business_stories_enabled then
      select id into v_business_id
      from public.content_items
      where status='published' and publication_date=v_edition_date and language=v_user.language
        and content_type='business_story' and metadata->>'staging_batch_id'=v_batch_id::text
      order by id limit 1;
      if v_business_id is not null then
        insert into public.daily_drop_items(daily_drop_id,content_item_id,slot,position)
        values(v_drop_id,v_business_id,'business_story',0) on conflict do nothing;
        if found then v_drop_items:=v_drop_items+1; end if;
      end if;
    end if;

    if v_user.mini_cases_enabled then
      v_mini_id:=null;
      select ci.id into v_mini_id
      from public.user_mini_case_topic_preferences mp
      join public.content_items ci
        on ci.status='published'
       and ci.publication_date=v_edition_date
       and ci.language=v_user.language
       and ci.content_type='mini_case'
       and ci.metadata->>'staging_batch_id'=v_batch_id::text
       and ci.metadata->>'product_topic'=mp.topic_id
      where mp.user_id=v_user.id and mp.enabled=true
      order by mp.position nulls last,mp.topic_id,ci.id
      limit 1;
      if v_mini_id is not null then
        insert into public.daily_drop_items(daily_drop_id,content_item_id,slot,position)
        values(v_drop_id,v_mini_id,'mini_case',0) on conflict do nothing;
        if found then v_drop_items:=v_drop_items+1; end if;
      end if;
    end if;

    v_drops_written:=v_drops_written+1;
  end loop;

  return jsonb_build_object(
    'published',true,
    'batch_id',v_batch_id,
    'edition_date',v_edition_date,
    'edition_kind',v_edition_kind,
    'run_id',p_run_id,
    'items_written',v_items_written,
    'items_reused',v_items_reused,
    'source_links_written',v_source_links,
    'daily_drops_written',v_drops_written,
    'daily_drop_items_written',v_drop_items,
    'retry_of_published_edition',v_edition_existed,
    'daily_drops_kept',v_drops_skipped,
    'publisher','public.publish_scheduled_staging_payload'
  );
end;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
