begin;
set local role service_role;
do $role_test$
declare
 v_name text:='qa-role-lifecycle-'||gen_random_uuid()::text;
 v_first date:=date_trunc('month',now() at time zone 'Europe/Paris')::date;
 v_final date:=(date_trunc('month',now() at time zone 'Europe/Paris')-interval '1 month')::date;
 v_result jsonb;
 v_tenant uuid;
 v_lease uuid;
 v_installment uuid;
begin
 if current_user<>'service_role' then raise exception 'ROLE01 actual role missing';end if;
 v_result:=public.marne_create_property(v_name,'Adresse QA');v_tenant:=(v_result->'row'->>'id')::uuid;
 update public.rental_tenant_rows set data=data||'{"Locataire":"Service role QA"}'::jsonb where id=v_tenant;
 v_result:=public.marne_prepare_lease(v_tenant,'qa-role');v_lease:=(v_result->'lease'->>'id')::uuid;
 if v_result->'lease'->>'status'<>'draft' then raise exception 'ROLE02 prepare failed';end if;
 v_result:=public.marne_save_lease(v_lease,jsonb_build_object('start_date',(v_first-interval '2 months')::date,
  'monthly_rent',500,'charges_amount',50,'due_day',5,'lease_kind','residential',
  'issuer_name','Bailleur QA','issuer_address','Adresse bailleur QA'),'qa-role',true);
 if v_result->'lease'->>'status'<>'active' or (v_result->>'installments_created')::integer<>2 then
  raise exception 'ROLE03 activation failed';end if;
 v_result:=public.marne_close_lease(v_lease,v_final+9,'qa-role',true);
 if v_result->'lease'->>'status'<>'closed' or (v_result->>'cancelled_installments')::integer<>2 then
  raise exception 'ROLE04 close failed';end if;
 v_result:=public.marne_set_partial_installment(v_lease,v_final,150,15,'qa-role',true);
 v_installment:=(v_result->'item'->>'id')::uuid;
 if v_result->>'created'<>'true' or v_result->'item'->>'amount_verified_by'<>'qa-role' then
  raise exception 'ROLE05 partial and audit failed';end if;
 v_result:=public.marne_record_payment(gen_random_uuid(),v_lease,(now() at time zone 'Europe/Paris')::date,
  25,'virement','QA',null,'','qa-role',v_installment);
 if (v_result->>'allocated')::numeric<>25 then raise exception 'ROLE06 closed debt payment failed';end if;
 raise notice 'Lifecycle service_role: 6 assertions passed; rollback follows';
end;
$role_test$;
rollback;

select jsonb_build_object(
 'rpc_acl',(select jsonb_agg(jsonb_build_object('function',p.proname,
  'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
  'security_invoker',not p.prosecdef) order by p.proname)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('marne_prepare_lease','marne_save_lease','marne_close_lease','marne_set_partial_installment')),
 'tables_with_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('rental_leases','rental_installments','rental_irl_applications','rental_irl_proposals') and c.relrowsecurity),
 'qa_properties_remaining',(select count(*) from public.rental_properties where name like 'qa-role-lifecycle-%')
) as lifecycle_postdeploy;
