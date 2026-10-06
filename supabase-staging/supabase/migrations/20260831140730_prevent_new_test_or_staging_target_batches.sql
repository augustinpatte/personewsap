create or replace function public.enforce_production_batch_mode()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if tg_op='INSERT' or new.edition_kind is distinct from old.edition_kind or new.target_project_ref is distinct from old.target_project_ref then
    if new.edition_kind not in ('daily','weekly_digest') then
      raise exception 'only daily or weekly_digest batches are allowed';
    end if;
    if coalesce(new.target_project_ref,'') <> 'wkbviidrbmehmjbhvpeh' then
      raise exception 'all active batches must target production';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_enforce_production_batch_mode on public.automation_batches;
create trigger trg_enforce_production_batch_mode
before insert or update of edition_kind,target_project_ref on public.automation_batches
for each row execute function public.enforce_production_batch_mode();;
