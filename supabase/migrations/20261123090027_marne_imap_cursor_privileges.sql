revoke all on table public.rental_mail_sync_cursors from service_role;
grant select,insert,update on table public.rental_mail_sync_cursors to service_role;

do $cursor_acl_audit$
declare
 v_role text;
 v_privilege text;
 v_expected boolean;
begin
 foreach v_role in array array['anon','authenticated','service_role'] loop
  foreach v_privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   v_expected:=v_role='service_role' and v_privilege in ('SELECT','INSERT','UPDATE');
   if has_table_privilege(v_role,'public.rental_mail_sync_cursors',v_privilege)
      is distinct from v_expected then
    raise exception 'QA_IMAP_CURSOR_UNEXPECTED_ACL: %, %',v_role,v_privilege;
   end if;
  end loop;
 end loop;
 if exists(
  select 1 from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  join pg_roles r on r.oid=a.grantee
  where c.oid='public.rental_mail_sync_cursors'::regclass and r.rolname='service_role'
   and (a.privilege_type not in ('SELECT','INSERT','UPDATE') or a.is_grantable)
 ) then raise exception 'QA_IMAP_CURSOR_EXTRA_DIRECT_PRIVILEGE';end if;
 if not (select relrowsecurity from pg_class where oid='public.rental_mail_sync_cursors'::regclass) then
  raise exception 'QA_IMAP_CURSOR_RLS_DISABLED';
 end if;
end $cursor_acl_audit$;

