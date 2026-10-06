create table if not exists public._premium_recovery_import_chunks_20260829 (
  seq integer primary key,
  chunk text not null,
  created_at timestamptz not null default now()
);
alter table public._premium_recovery_import_chunks_20260829 enable row level security;
revoke all on table public._premium_recovery_import_chunks_20260829 from anon, authenticated;
grant all on table public._premium_recovery_import_chunks_20260829 to service_role;;
