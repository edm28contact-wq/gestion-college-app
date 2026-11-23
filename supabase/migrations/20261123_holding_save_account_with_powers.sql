-- A single PostgREST RPC keeps account details and power assignments atomic.
create or replace function public.holding_save_account_with_powers(
  p_username text,
  p_details jsonb,
  p_power_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  existing_account public.admin_accounts%rowtype;
  account_uuid uuid;
  user_role text := p_details->>'role';
  direct_rights jsonb := p_details->'permissions';
  display text := left(coalesce(nullif(btrim(p_details->>'display_name'), ''),p_username),100);
  enabled boolean := coalesce((p_details->>'active')::boolean,true);
  must_reset boolean := coalesce((p_details->>'must_change_password')::boolean,true);
  password_provided boolean := nullif(p_details->>'password_hash','') is not null;
begin
  if p_username is null
    or p_username !~ '^[a-z0-9._-]{3,50}$'
    or p_username in ('admin','holding-admin')
    or user_role not in ('admin_limited','secretariat','comptabilite','marne_invest')
    or direct_rights is null or jsonb_typeof(direct_rights) <> 'object'
    or coalesce(cardinality(p_power_ids),0)>100 then
    raise exception 'Paramètres du compte invalides';
  end if;
  if exists (
    select 1 from jsonb_each(direct_rights) as r(code, value)
    where value <> 'true'::jsonb
      or (code <> 'readonly' and code !~ '^[a-z][a-z0-9._-]{1,79}$')
      or code = '*'
  ) or (select count(*) from jsonb_object_keys(direct_rights)) > 250 then
    raise exception 'Autorisations directes invalides';
  end if;

  select * into existing_account
  from public.admin_accounts
  where username = p_username
  for update;

  if not found then
    if not password_provided or nullif(p_details->>'password_salt','') is null
      or (p_details->>'password_iterations')::integer < 200000 then
      raise exception 'Mot de passe provisoire requis';
    end if;
    insert into public.admin_accounts (
      username, role, display_name, active, central_active,
      is_super_admin, permissions, direct_permissions,
      must_change_password, failed_login_count, locked_until,
      password_salt, password_hash, password_iterations, password_changed_at
    ) values (
      p_username, user_role, display, enabled, enabled,
      false, direct_rights, direct_rights,
      must_reset, 0, null,
      p_details->>'password_salt', p_details->>'password_hash',
      (p_details->>'password_iterations')::integer, now()
    )
    returning id into account_uuid;
  else
    update public.admin_accounts
    set role = user_role,
        display_name = display,
        active = enabled,
        central_active = enabled,
        is_super_admin = false,
        permissions = direct_rights,
        direct_permissions = direct_rights,
        must_change_password = must_reset,
        failed_login_count = 0,
        locked_until = null,
        password_salt = coalesce(nullif(p_details->>'password_salt',''),password_salt),
        password_hash = coalesce(nullif(p_details->>'password_hash',''),password_hash),
        password_iterations = coalesce((p_details->>'password_iterations')::integer,password_iterations),
        password_changed_at = case when password_provided then now() else password_changed_at end,
        session_version = session_version+1,
        updated_at = now()
    where id = existing_account.id
    returning id into account_uuid;
  end if;

  perform public.replace_admin_access_assignments(p_username,coalesce(p_power_ids,array[]::uuid[]));
  return account_uuid;
end;
$fn$;

revoke all on function public.holding_save_account_with_powers(text,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.holding_save_account_with_powers(text,jsonb,uuid[]) to service_role;
