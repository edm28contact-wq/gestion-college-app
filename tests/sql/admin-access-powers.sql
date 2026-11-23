-- Access powers regression test. Run as privileged service connection.
-- Transaction is rolled back; does not persist a power or account changes.
begin;
do $test$
declare
  who text;
  account_id uuid;
  original_direct jsonb;
  original_effective jsonb;
  original_version integer;
  current_effective jsonb;
  current_direct jsonb;
  v integer;
  power_id uuid;
begin
  select username, id, direct_permissions, permissions, session_version
    into who, account_id, original_direct, original_effective, original_version
  from public.admin_accounts
  where username <> 'admin'
  order by username
  limit 1 for update;
  if account_id is null then raise exception 'No non-admin test account'; end if;

  insert into public.admin_access_powers (code, name, permissions)
  values ('regression_access_roles','Regression test role','{"test.permission": true}'::jsonb)
  returning id into power_id;

  update public.admin_accounts
    set direct_permissions = original_direct || '{"readonly": true}'::jsonb
  where id = account_id;

  perform public.replace_admin_access_assignments(who, array[power_id]);
  select permissions, direct_permissions, session_version
    into current_effective, current_direct, v
  from public.admin_accounts where id = account_id;
  if current_effective->>'test.permission' <> 'true' then
    raise exception 'Assignment did not grant permission';
  end if;
  if current_effective->>'readonly' <> 'true' or current_direct->>'readonly' <> 'true' then
    raise exception 'Visitor protection lost';
  end if;
  if v <= original_version then
    raise exception 'Session was not invalidated';
  end if;

  update public.admin_access_powers
    set permissions = '{}'::jsonb
  where id = power_id;
  select permissions into current_effective
  from public.admin_accounts where id = account_id;
  if current_effective ? 'test.permission' then
    raise exception 'Power edit failed to revoke inherited right';
  end if;
  if current_effective->>'readonly' <> 'true' then
    raise exception 'Power edit removed direct readonly right';
  end if;

  perform public.replace_admin_access_assignments(who, array[]::uuid[]);
  if exists (
    select 1 from public.admin_access_assignments aa
    where aa.account_id = (select id from public.admin_accounts where username = who)
  ) then
    raise exception 'Assignment removal failed';
  end if;
end;
$test$;
rollback;
