begin;
set local role service_role;
do $role_test$
declare
 v_today date:=(now() at time zone 'Europe/Paris')::date;
 v_due date;
 v_year integer;
 v_unused integer;
 v_result jsonb;
 v_rule jsonb;
 v_tenant uuid;
 v_lease uuid;
 v_proposal uuid;
begin
 if current_user<>'service_role' then raise exception 'IRL_ROLE01 actual role missing';end if;
 select y into v_unused from generate_series(2001,2020) y where not exists(
  select 1 from public.rental_irl_indices where year=y and quarter=1) order by y limit 1;
 if v_unused is null then raise exception 'IRL role fixture year unavailable';end if;
 v_result:=public.marne_register_irl_index(v_unused,1,100,make_date(v_unused,4,15),
  'https://www.insee.fr/fr/statistiques/9999999','qa-role-irl',true);
 if v_result->>'already_exists'<>'false' or v_result->'item'->>'registered_by'<>'qa-role-irl' then
  raise exception 'IRL_ROLE02 index registration failed';end if;
 v_due:=make_date(extract(year from v_today)::integer,1,31);
 if v_due>v_today then v_due:=(v_due-interval '1 year')::date;end if;
 v_year:=extract(year from v_due)::integer-1;
 v_result:=public.marne_create_property('qa-role-irl-'||gen_random_uuid()::text,'Adresse QA');
 v_tenant:=(v_result->'row'->>'id')::uuid;
 update public.rental_tenant_rows set data=data||'{"Locataire":"IRL role QA"}'::jsonb where id=v_tenant;
 v_result:=public.marne_prepare_lease(v_tenant,'qa-role-irl');v_lease:=(v_result->'lease'->>'id')::uuid;
 perform public.marne_save_lease(v_lease,jsonb_build_object('start_date',(v_due-interval '2 years')::date,
  'monthly_rent',500,'charges_amount',50,'due_day',5,'lease_kind','residential',
  'issuer_name','Bailleur QA','issuer_address','Adresse QA'),'qa-role-irl',true);
 v_rule:=jsonb_build_object('has_revision_clause',true,'dpe_rating','C','is_mobility_lease',false,
  'geographic_scope','metropole','revision_due_on',v_due,'reference_quarter',4,'target_year',v_year);
 v_result:=public.marne_save_irl_rule(v_lease,v_rule,'qa-role-irl');
 if (v_result->'rule'->>'target_year')::integer<>v_year then raise exception 'IRL_ROLE03 rule save failed';end if;
 v_result:=public.marne_irl_prepare_proposal(v_lease,'qa-role-irl');v_proposal:=(v_result->>'proposal_id')::uuid;
 if (v_result->>'draft_revision')::integer<>1 or v_result->>'created'<>'true' then
  raise exception 'IRL_ROLE04 proposal prepare failed';end if;
 v_result:=public.marne_schedule_irl_application(v_proposal,v_today,'hand_signed','qa-role-irl',1);
 if v_result->>'ok'<>'true' or not exists(select 1 from public.rental_irl_applications where proposal_id=v_proposal and status='scheduled') then
  raise exception 'IRL_ROLE05 checked version schedule failed';end if;
 begin perform public.marne_save_irl_rule(v_lease,v_rule||'{"reference_quarter":3}'::jsonb,'qa-role-irl');
  raise exception 'IRL_ROLE06 scheduled rule edit accepted';exception when object_not_in_prerequisite_state then null;end;
 raise notice 'IRL service_role: 6 assertions passed; rollback follows';
end;
$role_test$;
rollback;

select jsonb_build_object(
 'rpc_acl',(select jsonb_agg(jsonb_build_object('function',p.proname,
  'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
  'security_invoker',not p.prosecdef) order by p.proname)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('marne_register_irl_index','marne_save_irl_rule','marne_irl_prepare_proposal','marne_schedule_irl_application')),
 'old_schedule_overload_absent',to_regprocedure('public.marne_schedule_irl_application(uuid,date,text,text)') is null,
 'tables_with_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('rental_irl_indices','rental_irl_lease_rules','rental_irl_proposals','rental_irl_applications') and c.relrowsecurity),
 'qa_properties_remaining',(select count(*) from public.rental_properties where name like 'qa-role-irl-%'),
 'qa_indices_remaining',(select count(*) from public.rental_irl_indices where registered_by='qa-role-irl')
) as irl_postdeploy;
