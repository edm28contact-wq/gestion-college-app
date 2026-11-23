create or replace function public.marne_prepare_reminder_draft(
 p_installment_id uuid,p_stage integer,p_expected_remaining numeric,
 p_recipient_email text,p_subject text,p_body text,p_by text
) returns jsonb
language plpgsql security invoker set search_path=''
as $function$
declare
 v_inst public.rental_installments%rowtype;
 v_lease public.rental_leases%rowtype;
 v_reminder public.rental_reminder_drafts%rowtype;
 v_remaining numeric;
 v_unallocated numeric;
 v_today date;
 v_prior timestamptz;
 v_email text;
 v_existing boolean;
begin
 if p_installment_id is null or p_stage is null or p_stage not in (7,14)
  or p_expected_remaining is null or p_expected_remaining<=0
  or p_expected_remaining>9999999999.99 or p_expected_remaining<>round(p_expected_remaining,2)
  or char_length(btrim(coalesce(p_recipient_email,''))) not between 3 and 254
  or btrim(p_recipient_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or char_length(btrim(coalesce(p_subject,''))) not between 1 and 500
  or char_length(btrim(coalesce(p_body,''))) not between 1 and 30000
  or char_length(btrim(coalesce(p_by,''))) not between 1 and 180
 then raise exception 'Relance invalide' using errcode='22023';end if;

 perform pg_advisory_xact_lock(hashtextextended('marne-lease-financial-transition',0));
 select * into v_inst from public.rental_installments where id=p_installment_id;
 if not found then raise exception 'Échéance introuvable' using errcode='22023';end if;
 select * into v_lease from public.rental_leases where id=v_inst.lease_id for no key update;
 if not found or v_lease.status<>'active' or v_lease.verified_at is null or v_lease.tenant_row_id is null
 then raise exception 'Bail non actif, non vérifié ou locataire non relié' using errcode='55000';end if;
 select * into v_inst from public.rental_installments where id=p_installment_id for update;
 if not found or v_inst.lease_id<>v_lease.id or v_inst.property_id<>v_lease.property_id
  or v_inst.status<>'scheduled' or v_lease.start_date is null
  or (v_inst.period+interval '1 month - 1 day')::date<v_lease.start_date
  or (v_lease.end_date is not null and v_inst.period>v_lease.end_date)
 then raise exception 'Échéance non active ou hors période du bail' using errcode='55000';end if;
 v_today:=(clock_timestamp() at time zone 'Europe/Paris')::date;
 if v_today-v_inst.due_on<p_stage
 then raise exception 'Délai de relance non atteint' using errcode='55000';end if;
 if p_stage=14 then
  select declared_sent_at into v_prior from public.rental_reminder_drafts
   where installment_id=v_inst.id and stage=7 and status='declared_sent';
  if v_prior is null or (v_prior at time zone 'Europe/Paris')::date>v_today-7
  then raise exception 'La relance J+7 doit avoir été déclarée envoyée depuis au moins sept jours' using errcode='55000';end if;
 end if;

 select greatest(0,v_inst.total_due-coalesce((
   select sum(a.amount) from public.rental_payment_allocations a
   join public.rental_payments p on p.id=a.payment_id and p.status='recorded'
   where a.installment_id=v_inst.id),0)),
  greatest(0,coalesce((select sum(p.amount-coalesce((
   select sum(a.amount) from public.rental_payment_allocations a where a.payment_id=p.id),0))
   from public.rental_payments p where p.lease_id=v_lease.id and p.status='recorded'),0))
 into v_remaining,v_unallocated;
 if v_remaining<=0 or v_unallocated>0
 then raise exception 'Échéance soldée ou paiement non affecté : vérifiez le rapprochement avant toute relance' using errcode='55000';end if;
 if v_remaining<>p_expected_remaining
 then raise exception 'Solde modifié pendant la préparation : actualisez avant de préparer la relance' using errcode='55000';end if;
 select btrim(coalesce(data->>'Mail locataire','')) into v_email
  from public.rental_tenant_rows where id=v_lease.tenant_row_id and property_id=v_lease.property_id;
 if v_email is null or lower(v_email)<>lower(btrim(p_recipient_email))
 then raise exception 'Adresse du locataire modifiée : actualisez avant de préparer la relance' using errcode='55000';end if;

 select * into v_reminder from public.rental_reminder_drafts
  where installment_id=v_inst.id and stage=p_stage for update;
 v_existing:=found;
 if v_existing and v_reminder.status='declared_sent' then
  return jsonb_build_object('ok',true,'already_exists',true,'reprepared',false,'item',to_jsonb(v_reminder));
 end if;
 if v_existing and (v_reminder.status not in ('prepared','cancelled')
  or v_reminder.declared_sent_at is not null or v_reminder.declared_sent_by is not null)
 then raise exception 'Une relance déjà déclarée ne peut pas être reconstruite' using errcode='55000';end if;
 if v_existing and v_reminder.status='prepared'
  and v_reminder.due_at_preparation=v_remaining and v_reminder.recipient_email=btrim(p_recipient_email)
  and v_reminder.subject=btrim(p_subject) and v_reminder.body=p_body then
  return jsonb_build_object('ok',true,'already_exists',true,'reprepared',false,'item',to_jsonb(v_reminder));
 end if;
 if v_existing then
  update public.rental_reminder_drafts set status='prepared',recipient_email=btrim(p_recipient_email),
   subject=btrim(p_subject),body=p_body,due_at_preparation=v_remaining,
   prepared_by=btrim(p_by),prepared_at=greatest(clock_timestamp(),prepared_at+interval '1 microsecond'),cancelled_at=null,cancelled_reason=null
   where id=v_reminder.id and status in ('prepared','cancelled')
    and declared_sent_at is null and declared_sent_by is null returning * into v_reminder;
 else
  insert into public.rental_reminder_drafts(installment_id,lease_id,stage,recipient_email,subject,body,
   due_at_preparation,prepared_by,prepared_at,status)
  values(v_inst.id,v_lease.id,p_stage,btrim(p_recipient_email),btrim(p_subject),p_body,
   v_remaining,btrim(p_by),clock_timestamp(),'prepared') returning * into v_reminder;
 end if;
 return jsonb_build_object('ok',true,'already_exists',false,'reprepared',v_existing,'item',to_jsonb(v_reminder));
end;
$function$;

create or replace function public.marne_declare_reminder_sent(
 p_reminder_id uuid,p_expected_prepared_at timestamptz,p_by text
) returns jsonb
language plpgsql security invoker set search_path=''
as $function$
declare
 v_inst public.rental_installments%rowtype;
 v_lease public.rental_leases%rowtype;
 v_reminder public.rental_reminder_drafts%rowtype;
 v_remaining numeric;
 v_unallocated numeric;
 v_today date;
 v_prior timestamptz;
 v_email text;
 v_reason text;
begin
 if p_reminder_id is null or p_expected_prepared_at is null or not isfinite(p_expected_prepared_at)
  or char_length(btrim(coalesce(p_by,''))) not between 1 and 180
 then raise exception 'Confirmation de relance invalide' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('marne-lease-financial-transition',0));
 select * into v_reminder from public.rental_reminder_drafts where id=p_reminder_id;
 if not found then return jsonb_build_object('ok',false,'code','reminder_missing','error','Relance introuvable');end if;
 select * into v_lease from public.rental_leases where id=v_reminder.lease_id for no key update;
 select * into v_inst from public.rental_installments where id=v_reminder.installment_id for update;
 select * into v_reminder from public.rental_reminder_drafts where id=p_reminder_id for update;
 if not found then return jsonb_build_object('ok',false,'code','reminder_missing','error','Relance introuvable');end if;
 if v_reminder.prepared_at is distinct from p_expected_prepared_at
 then raise exception 'Relance reconstruite depuis son affichage : actualisez et vérifiez le texte avant de confirmer' using errcode='55000';end if;
 if v_reminder.status='declared_sent' then return jsonb_build_object('ok',true,'already_exists',true);end if;
 if v_reminder.status<>'prepared' or v_reminder.declared_sent_at is not null or v_reminder.declared_sent_by is not null
 then raise exception 'Relance annulée ou historique non modifiable' using errcode='55000';end if;

 v_today:=(clock_timestamp() at time zone 'Europe/Paris')::date;
 if v_lease.id is null or v_lease.status<>'active' or v_lease.verified_at is null or v_lease.tenant_row_id is null
  or v_inst.id is null or v_inst.lease_id<>v_lease.id or v_inst.property_id<>v_lease.property_id
  or v_inst.status<>'scheduled' or v_lease.start_date is null
  or (v_inst.period+interval '1 month - 1 day')::date<v_lease.start_date
  or (v_lease.end_date is not null and v_inst.period>v_lease.end_date)
 then v_reason:='Bail ou échéance modifié : vérifiez la situation avant une relance';
 elsif v_today-v_inst.due_on<v_reminder.stage
 then v_reason:='Délai de relance non atteint';
 end if;
 if v_reason is null and v_reminder.stage=14 then
  select declared_sent_at into v_prior from public.rental_reminder_drafts
   where installment_id=v_inst.id and stage=7 and status='declared_sent';
  if v_prior is null or (v_prior at time zone 'Europe/Paris')::date>v_today-7
  then v_reason:='Le premier rappel doit avoir été déclaré envoyé depuis au moins sept jours';end if;
 end if;
 if v_reason is null then
  select greatest(0,v_inst.total_due-coalesce((
    select sum(a.amount) from public.rental_payment_allocations a
    join public.rental_payments p on p.id=a.payment_id and p.status='recorded'
    where a.installment_id=v_inst.id),0)),
   greatest(0,coalesce((select sum(p.amount-coalesce((
    select sum(a.amount) from public.rental_payment_allocations a where a.payment_id=p.id),0))
    from public.rental_payments p where p.lease_id=v_lease.id and p.status='recorded'),0))
  into v_remaining,v_unallocated;
  if v_remaining<=0 or v_unallocated>0 or v_remaining<>v_reminder.due_at_preparation
  then v_reason:='Situation financière modifiée : préparez un nouveau texte après vérification des paiements';end if;
 end if;
 if v_reason is null then
  select btrim(coalesce(data->>'Mail locataire','')) into v_email
   from public.rental_tenant_rows where id=v_lease.tenant_row_id and property_id=v_lease.property_id;
  if v_email is null or lower(v_email)<>lower(v_reminder.recipient_email)
  then v_reason:='Adresse du locataire modifiée : vérifiez le destinataire et préparez un nouveau texte';end if;
 end if;
 if v_reason is not null then
  update public.rental_reminder_drafts set status='cancelled',cancelled_at=clock_timestamp(),cancelled_reason=v_reason
   where id=v_reminder.id and status='prepared';
  return jsonb_build_object('ok',false,'code','reminder_stale','error',v_reason,'cancelled',true);
 end if;
 update public.rental_reminder_drafts set status='declared_sent',
  declared_sent_at=clock_timestamp(),declared_sent_by=btrim(p_by)
  where id=v_reminder.id and status='prepared';
 return jsonb_build_object('ok',true,'already_exists',false);
end;
$function$;

revoke all on function public.marne_prepare_reminder_draft(uuid,integer,numeric,text,text,text,text) from public,anon,authenticated;
revoke all on function public.marne_declare_reminder_sent(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.marne_prepare_reminder_draft(uuid,integer,numeric,text,text,text,text) to service_role;
grant execute on function public.marne_declare_reminder_sent(uuid,timestamptz,text) to service_role;

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
