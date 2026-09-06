do $$
begin
  if exists (select 1 from pg_roles where rolname = 'lijing_app') then
    execute 'grant select, insert, update, delete on table public.lijing_runtime_kv to lijing_app';
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'lijing_runtime_kv'
        and policyname = 'lijing_app_backend_access'
    ) then
      execute 'create policy lijing_app_backend_access on public.lijing_runtime_kv for all to lijing_app using (true) with check (true)';
    end if;
  end if;
end
$$;
