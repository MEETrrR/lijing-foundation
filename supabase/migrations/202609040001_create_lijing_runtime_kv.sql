create table if not exists public.lijing_runtime_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lijing_runtime_kv_key_length check (char_length(key) between 1 and 512)
);

comment on table public.lijing_runtime_kv is
  'Compatibility persistence adapter for the Lijing API vertical slice. Clients must never access this table directly.';

alter table public.lijing_runtime_kv enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.lijing_runtime_kv from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.lijing_runtime_kv from authenticated';
  end if;
end
$$;
revoke all on table public.lijing_runtime_kv from public;
