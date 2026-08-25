-- Curated launch catalog import helper (mini cases).
--
-- Recovered from the production database, where it was applied directly on
-- 2026-08-22 while importing the curated launch catalog v2. It existed in the
-- remote migration history but not in this repository, so a project rebuilt
-- from these migrations would have been missing it.
--
-- One-shot operational helper, not part of the reader-facing runtime: it takes
-- a JSON payload for one curated mini case and writes the FR and EN versions,
-- their source and their editorial-memory rows. SECURITY DEFINER, with EXECUTE
-- revoked from public/anon/authenticated so only service_role can call it.

create or replace function public.insert_curated_launch_mini_case(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id text := 'launch-catalog-v2-20260822-mini-case-' || (p->>'topic') || '-' || lpad((p->>'idx')::text,2,'0');
  v_source_id uuid;
  v_content_id uuid;
  v_lang text;
  v_title text;
  v_context text;
  v_mechanism text;
  v_signal text;
  v_interpretation text;
  v_action text;
  v_takeaway text;
  v_wrong_signal jsonb;
  v_wrong_interp jsonb;
  v_wrong_action jsonb;
  v_challenge text;
  v_body text;
  v_questions jsonb;
  v_metadata jsonb;
  v_slug text;
  v_published_at timestamptz;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'payload must be object'; end if;
  if p->>'topic' not in ('finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations') then raise exception 'invalid topic'; end if;
  if (p->>'idx')::int not between 6 and 10 then raise exception 'idx must be 6..10'; end if;
  if p->>'source_published_at' is not null and p->>'source_published_at' <> '' then v_published_at := (p->>'source_published_at')::timestamptz; end if;

  insert into sources(url,title,publisher,author,published_at,retrieved_at,language,credibility_score,content_hash)
  values(p->>'source_url',p->>'source_title',p->>'source_publisher',null,v_published_at,now(),'en',0.95,md5(p->>'source_url'))
  on conflict (url) do update set
    title=excluded.title,
    publisher=excluded.publisher,
    published_at=coalesce(excluded.published_at,sources.published_at),
    retrieved_at=now(),
    credibility_score=greatest(coalesce(sources.credibility_score,0),excluded.credibility_score),
    content_hash=excluded.content_hash
  returning id into v_source_id;

  delete from mini_case_history where content_item_id in (
    select id from content_items where metadata->>'catalog_entry_id'=v_entry_id
  );
  delete from content_item_sources where content_item_id in (
    select id from content_items where metadata->>'catalog_entry_id'=v_entry_id
  );
  delete from content_items where metadata->>'catalog_entry_id'=v_entry_id;

  foreach v_lang in array array['en','fr'] loop
    if v_lang='en' then
      v_title:=p->>'title_en'; v_context:=p->>'context_en'; v_mechanism:=p->>'mechanism_en';
      v_signal:=p->>'signal_en'; v_interpretation:=p->>'interpretation_en'; v_action:=p->>'action_en'; v_takeaway:=p->>'takeaway_en';
      v_wrong_signal:=p->'wrong_signals_en'; v_wrong_interp:=p->'wrong_interps_en'; v_wrong_action:=p->'wrong_actions_en';
      v_challenge:='Use the evidence to identify the binding signal, reject the tempting shortcut, and choose the most defensible next action.';
      v_body:='**Situation:** '||v_context||E'\n\n**Mechanism:** '||v_mechanism||' The trap is to optimize a headline metric before checking whether it is causally connected to the outcome that matters. Treat the public source as an anchor for the real-world mechanism, not as proof of every assumption in this fictional decision.'||E'\n\n**Decision:** '||v_challenge||' Start with the signal that would materially change the choice, separate observed evidence from inference, then prefer a reversible or gated action when uncertainty remains.'||E'\n\n**What good reasoning looks like:** '||v_takeaway||E'\n\nSource: '||(p->>'source_publisher')||case when v_published_at is null then '' else ', published '||to_char(v_published_at,'YYYY-MM-DD') end||', retrieved 2026-08-22. '||(p->>'source_url');
      v_questions:=jsonb_build_array(
        jsonb_build_object('id','q1','role','method_framework','question','Which signal should be checked first?','options',jsonb_build_array(
          jsonb_build_object('id','A','text',v_signal,'feedback','Correct: this signal is closest to the mechanism that changes the decision.','is_correct',true),
          jsonb_build_object('id','B','text',v_wrong_signal->>0,'feedback','Plausible, but it does not isolate the decision mechanism.','is_correct',false),
          jsonb_build_object('id','C','text',v_wrong_signal->>1,'feedback','Plausible, but it does not isolate the decision mechanism.','is_correct',false),
          jsonb_build_object('id','D','text',v_wrong_signal->>2,'feedback','Plausible, but it does not isolate the decision mechanism.','is_correct',false))),
        jsonb_build_object('id','q2','role','technical_application','question','Which interpretation is most defensible?','options',jsonb_build_array(
          jsonb_build_object('id','A','text',v_wrong_interp->>0,'feedback','This conclusion goes beyond the evidence.','is_correct',false),
          jsonb_build_object('id','B','text',v_interpretation,'feedback','Correct: it separates evidence from overclaim.','is_correct',true),
          jsonb_build_object('id','C','text',v_wrong_interp->>1,'feedback','This conclusion goes beyond the evidence.','is_correct',false),
          jsonb_build_object('id','D','text',v_wrong_interp->>2,'feedback','This conclusion goes beyond the evidence.','is_correct',false))),
        jsonb_build_object('id','q3','role','conclusion_decision','question','What is the best next action?','options',jsonb_build_array(
          jsonb_build_object('id','A','text',v_wrong_action->>0,'feedback','This acts before resolving the key uncertainty.','is_correct',false),
          jsonb_build_object('id','B','text',v_wrong_action->>1,'feedback','This acts before resolving the key uncertainty.','is_correct',false),
          jsonb_build_object('id','C','text',v_action,'feedback','Correct: it addresses the mechanism while controlling uncertainty.','is_correct',true),
          jsonb_build_object('id','D','text',v_wrong_action->>2,'feedback','This acts before resolving the key uncertainty.','is_correct',false)))
      );
    else
      v_title:=p->>'title_fr'; v_context:=p->>'context_fr'; v_mechanism:=p->>'mechanism_fr';
      v_signal:=p->>'signal_fr'; v_interpretation:=p->>'interpretation_fr'; v_action:=p->>'action_fr'; v_takeaway:=p->>'takeaway_fr';
      v_wrong_signal:=p->'wrong_signals_fr'; v_wrong_interp:=p->'wrong_interps_fr'; v_wrong_action:=p->'wrong_actions_fr';
      v_challenge:='Utilise les preuves pour identifier le signal contraignant, rejeter le raccourci tentant et choisir l’action suivante la plus défendable.';
      v_body:='**Situation :** '||v_context||E'\n\n**Mécanisme :** '||v_mechanism||' Le piège consiste à optimiser un indicateur visible avant de vérifier s’il est réellement lié au résultat qui compte. Considère la source publique comme un ancrage du mécanisme réel, pas comme la preuve de toutes les hypothèses de cette décision fictive.'||E'\n\n**Décision :** '||v_challenge||' Commence par le signal susceptible de changer matériellement le choix, sépare les faits observés de l’interprétation, puis privilégie une action réversible ou progressive lorsque l’incertitude demeure.'||E'\n\n**Ce qu’un bon raisonnement doit retenir :** '||v_takeaway||E'\n\nSource : '||(p->>'source_publisher')||case when v_published_at is null then '' else ', publié le '||to_char(v_published_at,'YYYY-MM-DD') end||', consulté le 2026-08-22. '||(p->>'source_url');
      v_questions:=jsonb_build_array(
        jsonb_build_object('id','q1','role','method_framework','question','Quel signal faut-il vérifier en premier ?','options',jsonb_build_array(
          jsonb_build_object('id','A','text',v_signal,'feedback','Correct : ce signal est le plus proche du mécanisme qui change la décision.','is_correct',true),
          jsonb_build_object('id','B','text',v_wrong_signal->>0,'feedback','Plausible, mais cela n’isole pas le mécanisme de décision.','is_correct',false),
          jsonb_build_object('id','C','text',v_wrong_signal->>1,'feedback','Plausible, mais cela n’isole pas le mécanisme de décision.','is_correct',false),
          jsonb_build_object('id','D','text',v_wrong_signal->>2,'feedback','Plausible, mais cela n’isole pas le mécanisme de décision.','is_correct',false))),
        jsonb_build_object('id','q2','role','technical_application','question','Quelle interprétation est la plus défendable ?','options',jsonb_build_array(
          jsonb_build_object('id','A','text',v_wrong_interp->>0,'feedback','Cette conclusion dépasse les preuves disponibles.','is_correct',false),
          jsonb_build_object('id','B','text',v_interpretation,'feedback','Correct : cette lecture sépare les preuves de la surinterprétation.','is_correct',true),
          jsonb_build_object('id','C','text',v_wrong_interp->>1,'feedback','Cette conclusion dépasse les preuves disponibles.','is_correct',false),
          jsonb_build_object('id','D','text',v_wrong_interp->>2,'feedback','Cette conclusion dépasse les preuves disponibles.','is_correct',false))),
        jsonb_build_object('id','q3','role','conclusion_decision','question','Quelle est la meilleure action suivante ?','options',jsonb_build_array(
          jsonb_build_object('id','A','text',v_wrong_action->>0,'feedback','Cette action intervient avant de résoudre l’incertitude clé.','is_correct',false),
          jsonb_build_object('id','B','text',v_wrong_action->>1,'feedback','Cette action intervient avant de résoudre l’incertitude clé.','is_correct',false),
          jsonb_build_object('id','C','text',v_action,'feedback','Correct : cette action traite le mécanisme tout en contrôlant l’incertitude.','is_correct',true),
          jsonb_build_object('id','D','text',v_wrong_action->>2,'feedback','Cette action intervient avant de résoudre l’incertitude clé.','is_correct',false)))
      );
    end if;

    v_metadata:=jsonb_build_object(
      'slot','mini_case','context',v_context,'question',case when v_lang='en' then 'What should the decision-maker do next?' else 'Quelle décision faut-il prendre maintenant ?' end,
      'challenge',v_challenge,'dedup_key',encode(digest(v_entry_id||':'||v_lang,'sha256'),'hex'),'mechanism',v_mechanism,'questions',v_questions,'score_max',3,
      'conclusion',v_takeaway,'constraints',case when v_lang='en' then jsonb_build_array('Use only the facts in the scenario and source anchor.','Do not treat a headline metric as a causal result.','Prefer evidence that can change the decision.') else jsonb_build_array('Utiliser uniquement les faits du scénario et l’ancrage source.','Ne pas confondre un indicateur visible avec un résultat causal.','Privilégier les preuves susceptibles de changer la décision.') end,
      'source_urls',jsonb_build_array(p->>'source_url'),'dedup_run_id',v_entry_id,'is_test_data',false,'persisted_by','ChatGPT curated launch catalog v2','core_takeaway',v_takeaway,
      'decision_type',p->>'decision','prerequisites',jsonb_build_array(p->>'concept'),'product_topic',p->>'topic','sample_answer',v_interpretation||' '||v_action,
      'scenario_type',p->>'scenario','surprise_fact',v_takeaway,'cognitive_load','medium','concept_tested',p->>'concept','content_status','published','final_takeaway',v_takeaway,
      'scheduler_mode','bootstrap-catalog','learning_points',jsonb_build_array(p->>'concept',p->>'decision'),'bootstrap_run_id','launch-catalog-v2-20260822','catalog_entry_id',v_entry_id,
      'next_recommended',jsonb_build_array(p->>'concept'),'question_pattern',p->>'pattern','scheduler_run_id',v_entry_id,'expected_reasoning',jsonb_build_array(v_signal,v_interpretation,v_action),
      'catalog_entry_index',(p->>'idx')::int-1,'catalog_content_type','mini_case','business_context_type','inspired_by_real_events','safe_persistence_note','Curated launch catalog. Assigned only through hidden launch seed drops; no newsletter.',
      'correct_answer_pattern',p->>'answer_pattern','source_url_fingerprint',encode(digest(p->>'source_url','sha256'),'hex'),'catalog_mini_case_topic',p->>'topic','generator','chatgpt_curated_launch'
    );

    insert into content_items(content_type,topic_id,language,title,summary,body_md,difficulty,estimated_read_seconds,publication_date,version,status,generation_run_id,source_count,metadata)
    values('mini_case',p->>'topic_id',v_lang,v_title,v_challenge,v_body,'medium',60,'2026-08-21',1,'published',null,1,v_metadata)
    returning id into v_content_id;

    insert into content_item_sources(content_item_id,source_id,claim,source_order) values(v_content_id,v_source_id,null,0);
    v_slug:=lower(replace(v_entry_id,'_','-'))||'-'||v_lang;
    insert into mini_case_history(content_item_id,title,slug,topic,scenario_type,decision_type,concept_tested,mechanism,difficulty,question_pattern,correct_answer_pattern,core_takeaway,published_date,language)
    values(v_content_id,v_title,v_slug,p->>'topic',p->>'scenario',p->>'decision',p->>'concept',v_mechanism,'medium',p->>'pattern',p->>'answer_pattern',v_takeaway,'2026-08-21',v_lang);
  end loop;
  return v_content_id;
end;
$$;
revoke all on function public.insert_curated_launch_mini_case(jsonb) from public, anon, authenticated;
