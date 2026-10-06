create or replace function public._premium_recovery_bridge_20260829(p_secret text, p_item jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if p_secret is distinct from 'BaMaCeAf9AvaubOsFTSL88wiTJ8u4aO3IU3e4BVJzwzh3mKG0FVMWMM5D-KQVsEw' then
    raise exception 'unauthorized';
  end if;
  return public._premium_recovery_import_item_20260829(p_item);
end;
$function$;
revoke all on function public._premium_recovery_bridge_20260829(text,jsonb) from public;
grant execute on function public._premium_recovery_bridge_20260829(text,jsonb) to anon;;
