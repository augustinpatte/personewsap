-- Recovered from the production database on 2026-09-01.
--
-- This migration was applied to wkbviidrbmehmjbhvpeh directly and never had a
-- file here, so `supabase db push` refused to run at all: it will not touch a
-- database holding migrations it cannot see. The SQL below is the statement
-- recorded verbatim in supabase_migrations.schema_migrations for this version —
-- read back, not reconstructed. No database was changed to create this file.

create or replace function public.enforce_personews_published_quality()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_words integer;
  v_expected_topic text;
begin
  if new.status <> 'published' then return new; end if;

  if coalesce(new.metadata->>'persisted_by','') <> 'public.publish_scheduled_staging_payload'
     and coalesce(new.metadata->>'preview_mode','') <> 'business_story' then
    return new;
  end if;

  select count(*) into v_words
  from regexp_split_to_table(trim(coalesce(new.body_md,'')), E'\\s+') w
  where w <> '';

  if new.content_type='newsletter_article' and (v_words < 220 or v_words > 275) then
    raise exception 'published newsletter body word count % outside 220-275', v_words;
  elsif new.content_type='business_story' then
    if v_words < 750 or v_words > 950 then
      raise exception 'published business story body word count % outside 750-950', v_words;
    end if;
    if coalesce(new.source_count,0) < 2 then
      raise exception 'published business story requires at least 2 sources';
    end if;
    if new.topic_id <> 'business' then
      raise exception 'published business story topic must be business, got %',new.topic_id;
    end if;
  elsif new.content_type='mini_case' then
    if v_words < 200 or v_words > 320 then
      raise exception 'published mini case body word count % outside 200-320',v_words;
    end if;
    v_expected_topic := case new.metadata->>'product_topic'
      when 'finance_economy' then 'finance'
      when 'stock_market' then 'finance'
      when 'ai' then 'tech_ai'
      when 'law_compliance' then 'law'
      when 'health_pharma' then 'medicine'
      when 'engineering_operations' then 'engineering'
      else null
    end;
    if v_expected_topic is null or new.topic_id <> v_expected_topic then
      raise exception 'published mini case topic mismatch: product_topic %, topic_id %, expected %',
        new.metadata->>'product_topic',new.topic_id,v_expected_topic;
    end if;
  end if;

  return new;
end;
$function$;
