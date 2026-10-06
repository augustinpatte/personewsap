create table if not exists public.task_bridge_chunks (
  sid text not null,
  seq integer not null check (seq >= 0),
  total integer not null check (total > 0 and total <= 100),
  kind text not null check (kind in ('outputs','reviews')),
  payload text not null,
  created_at timestamptz not null default now(),
  primary key (sid, seq)
);
alter table public.task_bridge_chunks enable row level security;
revoke all on table public.task_bridge_chunks from public, anon, authenticated;
grant select, insert, update, delete on table public.task_bridge_chunks to service_role;;
