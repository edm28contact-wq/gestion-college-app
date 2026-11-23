begin;
set local role service_role;
do $regression$
declare
 v_prefix text:='qa-reminder-transactions-'||gen_random_uuid()::text;
 v_today date:=(clock_timestamp() at time zone 'Europe/Paris')::date;
 v_period date:=(date_trunc('month',clock_timestamp() at time zone 'Europe/Paris')-interval '1 month')::date;
 v_property uuid;
 v_tenant uuid;
 v_lease uuid;
 v_inst uuid;
 v_reminder uuid;
 v_second uuid;
 v_payment uuid;
 v_unallocated uuid;
 v_final uuid;
 v_stamp timestamptz;
 v_new_stamp timestamptz;
 v_result jsonb;
 v_before jsonb;
 v_checks integer:=0;
begin
 begin
  perform pg_advisory_xact_lock(hashtextextended('marne-tenant-row-number',0));
  insert into public.rental_properties(name,data) values(v_prefix,'{"Adresse":"Adresse QA"}') returning id into v_property;
  insert into public.rental_tenant_rows(row_number,property_id,data)
   values((select coalesce(max(row_number),1)+1 from public.rental_tenant_rows),v_property,
   '{"Locataire":"Locataire QA","Mail locataire":"qa@example.invalid"}') returning id into v_tenant;
  insert into public.rental_leases(property_id,tenant_row_id,tenant_name,start_date,monthly_rent,charges_amount,due_day,
   status,verified_at,verified_by,lease_kind,issuer_name,issuer_address)
   values(v_property,v_tenant,'Locataire QA',v_period+9,500,50,5,'active',clock_timestamp(),'qa','residential','QA','Adresse QA') returning id into v_lease;
  v_result:=public.marne_set_partial_installment(v_lease,v_period,150,15,'qa',true);
  v_inst:=(v_result->'item'->>'id')::uuid;
  v_result:=public.marne_prepare_reminder_draft(v_inst,7,165,'qa@example.invalid','Rappel QA','Solde QA 165','qa');
  v_reminder:=(v_result->'item'->>'id')::uuid;v_stamp:=(v_result->'item'->>'prepared_at')::timestamptz;
  if v_result->>'already_exists'<>'false' or v_result->'item'->>'status'<>'prepared'
   or (v_result->'item'->>'due_at_preparation')::numeric<>165 then raise exception 'R01 create draft';end if;v_checks:=v_checks+1;
  v_result:=public.marne_prepare_reminder_draft(v_inst,7,165,'qa@example.invalid','Rappel QA','Solde QA 165','qa');
  if v_result->>'already_exists'<>'true' or (v_result->'item'->>'prepared_at')::timestamptz<>v_stamp then
   raise exception 'R02 exact retry preserves version';end if;v_checks:=v_checks+1;

  perform public.marne_set_partial_installment(v_lease,v_period,160,16,'qa',true);
  if (select status from public.rental_reminder_drafts where id=v_reminder)<>'cancelled' then
   raise exception 'R03 corrected partial cancels draft';end if;v_checks:=v_checks+1;
  begin
   perform public.marne_prepare_reminder_draft(v_inst,7,165,'qa@example.invalid','Rappel QA','Old solde QA165','qa');
   raise exception 'R04 stale expected amount accepted';
  exception when sqlstate '55000' then v_checks:=v_checks+1;end;
  if (select status from public.rental_reminder_drafts where id=v_reminder)<>'cancelled' then
   raise exception 'R05 stale reprepare resurrected draft';end if;v_checks:=v_checks+1;
  v_result:=public.marne_prepare_reminder_draft(v_inst,7,176,'qa@example.invalid','Rappel QA','Solde QA 176','qa');
  v_new_stamp:=(v_result->'item'->>'prepared_at')::timestamptz;
  if (v_result->'item'->>'id')::uuid<>v_reminder or v_result->>'reprepared'<>'true'
   or v_result->'item'->>'status'<>'prepared' or v_new_stamp<=v_stamp then raise exception 'R06 cancelled draft rebuilt in place';end if;v_checks:=v_checks+1;
  begin
   perform public.marne_declare_reminder_sent(v_reminder,v_stamp,'qa');
   raise exception 'R07 stale UI version accepted';
  exception when sqlstate '55000' then v_checks:=v_checks+1;end;
  if (select status from public.rental_reminder_drafts where id=v_reminder)<>'prepared' then
   raise exception 'R08 stale UI altered current draft';end if;v_checks:=v_checks+1;
  v_result:=public.marne_declare_reminder_sent(v_reminder,v_new_stamp,'qa');
  if v_result->>'ok'<>'true' or v_result->>'already_exists'<>'false' then raise exception 'R09 current version declared';end if;v_checks:=v_checks+1;
  select to_jsonb(r) into v_before from public.rental_reminder_drafts r where id=v_reminder;
  v_result:=public.marne_declare_reminder_sent(v_reminder,v_new_stamp,'another-qa');
  if v_result->>'already_exists'<>'true' or (select to_jsonb(r) from public.rental_reminder_drafts r where id=v_reminder)<>v_before then
   raise exception 'R10 declaration retry immutable';end if;v_checks:=v_checks+1;
  v_result:=public.marne_prepare_reminder_draft(v_inst,7,176,'qa@example.invalid','New subject','New content','qa');
  if v_result->>'already_exists'<>'true' or (select to_jsonb(r) from public.rental_reminder_drafts r where id=v_reminder)<>v_before then
   raise exception 'R11 declared content immutable';end if;v_checks:=v_checks+1;
  begin
   perform public.marne_set_partial_installment(v_lease,v_period,170,17,'qa',true);
   raise exception 'R12 declared reminder allowed rewriting partial';
  exception when sqlstate '55000' then v_checks:=v_checks+1;end;
  begin
   perform public.marne_prepare_reminder_draft(v_inst,14,176,'qa@example.invalid','Rappel2 QA','Solde QA176','qa');
   raise exception 'R13 stage14 without 7 days accepted';
  exception when sqlstate '55000' then v_checks:=v_checks+1;end;
  update public.rental_reminder_drafts set declared_sent_at=clock_timestamp()-interval '8 days' where id=v_reminder;
  v_result:=public.marne_prepare_reminder_draft(v_inst,14,176,'qa@example.invalid','Rappel2 QA','Solde QA176','qa');
  v_second:=(v_result->'item'->>'id')::uuid;v_stamp:=(v_result->'item'->>'prepared_at')::timestamptz;
  if v_result->'item'->>'status'<>'prepared' then raise exception 'R14 eligible stage14';end if;v_checks:=v_checks+1;

  v_result:=public.marne_record_payment(gen_random_uuid(),v_lease,v_today,100,'virement','QA',null,'','qa',v_inst);
  v_payment:=(v_result->>'id')::uuid;
  v_result:=public.marne_declare_reminder_sent(v_second,v_stamp,'qa');
  if v_result->>'ok'<>'false' or v_result->>'code'<>'reminder_stale'
   or (select status from public.rental_reminder_drafts where id=v_second)<>'cancelled' then
   raise exception 'R15 payment amount change cancels stale draft durably';end if;v_checks:=v_checks+1;
  v_result:=public.marne_prepare_reminder_draft(v_inst,14,76,'qa@example.invalid','Rappel2 QA','Solde QA76','qa');
  v_stamp:=(v_result->'item'->>'prepared_at')::timestamptz;
  if v_result->>'reprepared'<>'true' then raise exception 'R16 partial payment allows corrected reminder';end if;v_checks:=v_checks+1;
  v_result:=public.marne_record_payment(gen_random_uuid(),v_lease,v_today,10,'virement','QA waiting',null,'','qa',null);
  v_unallocated:=(v_result->>'id')::uuid;
  v_result:=public.marne_declare_reminder_sent(v_second,v_stamp,'qa');
  if v_result->>'code'<>'reminder_stale' or (select status from public.rental_reminder_drafts where id=v_second)<>'cancelled'
   then raise exception 'R17 unallocated payment blocks declaration';end if;v_checks:=v_checks+1;
  begin
   perform public.marne_prepare_reminder_draft(v_inst,14,76,'qa@example.invalid','Rappel2 QA','Solde QA76','qa');
   raise exception 'R18 unallocated payment allowed preparation';
  exception when sqlstate '55000' then v_checks:=v_checks+1;end;
  perform public.marne_allocate_payment(v_unallocated,v_inst,10);
  v_result:=public.marne_prepare_reminder_draft(v_inst,14,66,'qa@example.invalid','Rappel2 QA','Solde QA66','qa');
  v_stamp:=(v_result->'item'->>'prepared_at')::timestamptz;
  if (v_result->'item'->>'due_at_preparation')::numeric<>66 then raise exception 'R19 reconciled payment amount';end if;v_checks:=v_checks+1;
  perform public.marne_void_payment(v_payment,'Annulation QA','qa');
  v_result:=public.marne_declare_reminder_sent(v_second,v_stamp,'qa');
  if v_result->>'code'<>'reminder_stale' then raise exception 'R20 void payment invalidates draft';end if;v_checks:=v_checks+1;
  v_result:=public.marne_prepare_reminder_draft(v_inst,14,166,'qa@example.invalid','Rappel2 QA','Solde QA166','qa');
  v_stamp:=(v_result->'item'->>'prepared_at')::timestamptz;
  update public.rental_tenant_rows set data=data||'{"Mail locataire":"new@example.invalid"}' where id=v_tenant;
  v_result:=public.marne_declare_reminder_sent(v_second,v_stamp,'qa');
  if v_result->>'code'<>'reminder_stale' then raise exception 'R21 changed recipient invalidates draft';end if;v_checks:=v_checks+1;
  begin
   perform public.marne_prepare_reminder_draft(v_inst,14,166,'qa@example.invalid','Rappel2 QA','Solde QA166','qa');
   raise exception 'R22 stale recipient allowed preparation';
  exception when sqlstate '55000' then v_checks:=v_checks+1;end;
  v_result:=public.marne_prepare_reminder_draft(v_inst,14,166,'new@example.invalid','Rappel2 QA','Solde QA166','qa');
  v_stamp:=(v_result->'item'->>'prepared_at')::timestamptz;
  v_result:=public.marne_record_payment(gen_random_uuid(),v_lease,v_today,166,'virement','QA full',null,'','qa',v_inst);
  v_final:=(v_result->>'id')::uuid;
  v_result:=public.marne_declare_reminder_sent(v_second,v_stamp,'qa');
  if v_result->>'code'<>'reminder_stale' then raise exception 'R23 paid installment invalidates draft';end if;v_checks:=v_checks+1;
  begin
   perform public.marne_prepare_reminder_draft(v_inst,14,166,'new@example.invalid','Rappel2 QA','Solde QA166','qa');
   raise exception 'R24 paid installment allowed reminder';
  exception when sqlstate '55000' then v_checks:=v_checks+1;end;
  perform public.marne_void_payment(v_final,'Annulation QA','qa');
  v_result:=public.marne_prepare_reminder_draft(v_inst,14,166,'new@example.invalid','Rappel2 QA','Solde QA166','qa');
  v_stamp:=(v_result->'item'->>'prepared_at')::timestamptz;
  v_result:=public.marne_record_payment(gen_random_uuid(),v_lease,v_today,1,'virement','QA changed prepared',null,'','qa',v_inst);
  v_final:=(v_result->>'id')::uuid;
  v_result:=public.marne_prepare_reminder_draft(v_inst,14,165,'new@example.invalid','Rappel2 QA','Solde QA165','qa');
  v_new_stamp:=(v_result->'item'->>'prepared_at')::timestamptz;
  if v_result->>'reprepared'<>'true' or (v_result->'item'->>'due_at_preparation')::numeric<>165 or v_new_stamp<=v_stamp
   then raise exception 'R31 stale prepared draft rebuilt atomically';end if;v_checks:=v_checks+1;
  begin
   perform public.marne_declare_reminder_sent(v_second,v_stamp,'qa');
   raise exception 'R32 version before prepared rebuild accepted';
  exception when sqlstate '55000' then v_checks:=v_checks+1;end;
  if (select status from public.rental_reminder_drafts where id=v_second)<>'prepared' then
   raise exception 'R33 stale declaration cancelled rebuilt draft';end if;v_checks:=v_checks+1;
  v_stamp:=v_new_stamp;
  perform public.marne_close_lease(v_lease,v_today,'qa',true);
  v_result:=public.marne_declare_reminder_sent(v_second,v_stamp,'qa');
  if v_result->>'code'<>'reminder_stale' then raise exception 'R25 closed lease invalidates draft';end if;v_checks:=v_checks+1;
  begin
   perform public.marne_prepare_reminder_draft(v_inst,14,166,'new@example.invalid','Rappel2 QA','Solde QA166','qa');
   raise exception 'R26 closed lease allowed reminder';
  exception when sqlstate '55000' then v_checks:=v_checks+1;end;
  v_result:=public.marne_declare_reminder_sent(gen_random_uuid(),clock_timestamp(),'qa');
  if v_result->>'code'<>'reminder_missing' then raise exception 'R27 absent reminder';end if;v_checks:=v_checks+1;
  begin
   perform public.marne_prepare_reminder_draft(v_inst,7,1.001,'new@example.invalid','QA','QA','qa');
   raise exception 'R28 invalid amount accepted';
  exception when sqlstate '22023' then v_checks:=v_checks+1;end;
  begin
   perform public.marne_declare_reminder_sent(v_reminder,null,'qa');
   raise exception 'R29 missing version accepted';
  exception when sqlstate '22023' then v_checks:=v_checks+1;end;
  raise exception using errcode='ZRM21',message='Rollback reminder regression fixtures';
 exception when sqlstate 'ZRM21' then null;
 end;
 if exists(select 1 from public.rental_properties where name=v_prefix)
  or exists(select 1 from public.rental_reminder_drafts where lease_id=v_lease)
 then raise exception 'R30 fixtures escaped rollback';end if;v_checks:=v_checks+1;
 if v_checks<>33 then raise exception 'Unexpected reminder assertion count: %',v_checks;end if;
 raise notice 'Reminder regression: % assertions passed; all fixtures rolled back',v_checks;
end;
$regression$;

rollback;

select p.proname,
 pg_get_function_identity_arguments(p.oid) as arguments,
 not p.prosecdef as security_invoker,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('marne_prepare_reminder_draft','marne_declare_reminder_sent')
 order by p.proname;
