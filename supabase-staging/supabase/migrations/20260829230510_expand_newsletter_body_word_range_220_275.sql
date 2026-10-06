do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='validate_generation_output'
    and pg_get_function_arguments(p.oid)='p_job_id uuid, p_output_json jsonb, p_source_records jsonb';

  if v_def is null then
    raise exception 'validate_generation_output function not found';
  end if;

  if position('if v_words < 120 or v_words > 220 then' in v_def)=0 then
    raise exception 'expected newsletter word-range clause not found';
  end if;

  v_def := replace(v_def,
    'if v_words < 120 or v_words > 220 then',
    'if v_words < 220 or v_words > 275 then');
  v_def := replace(v_def,
    ':newsletter_body_words_'' || v_words || ''_outside_120_220',
    ':newsletter_body_words_'' || v_words || ''_outside_220_275');

  execute v_def;
end
$migration$;;
